#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.join(__dirname, "..", "templates");
const distDir = path.join(__dirname, "..", "dist");

const command = process.argv[2];
const args = process.argv.slice(3);

function newSessionId() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function run(repo, cmdArgs, sessionId = null) {
  const result = spawnSync("opencode", cmdArgs, {
    cwd: repo,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      ...(sessionId ? { IRVING_SESSION_ID: sessionId } : {}),
    },
  });
  return result.status ?? 1;
}

async function readState(repo, sessionId) {
  const file = path.join(repo, ".opencode", "irving", sessionId, "state.json");
  return JSON.parse(await readFile(file, "utf8"));
}

async function readPlan(repo, sessionId) {
  const file = path.join(repo, ".opencode", "irving", sessionId, "plan.json");
  return JSON.parse(await readFile(file, "utf8"));
}

async function askHuman(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`\n? ${question}\n> `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

if (command === "init") {
  const target = args[0] ?? process.cwd();
  const opencodeDir = path.join(target, ".opencode");

  if (!existsSync(opencodeDir)) {
    mkdirSync(opencodeDir, { recursive: true });
  }

  const agentsDir = path.join(opencodeDir, "agents");
  if (!existsSync(agentsDir)) {
    mkdirSync(agentsDir, { recursive: true });
  }
  cpSync(path.join(templatesDir, "agents"), agentsDir, { recursive: true });
  console.log(`Scaffolded agents to ${agentsDir}`);

  const commandsDir = path.join(opencodeDir, "commands");
  if (!existsSync(commandsDir)) {
    mkdirSync(commandsDir, { recursive: true });
  }
  cpSync(path.join(templatesDir, "commands"), commandsDir, { recursive: true });
  console.log(`Scaffolded commands to ${commandsDir}`);

  const binDir = path.join(opencodeDir, "bin");
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }
  const binTemplates = path.join(templatesDir, "bin");
  if (existsSync(binTemplates)) {
    cpSync(binTemplates, binDir, { recursive: true });
    console.log(`Scaffolded bin helpers to ${binDir}`);
  }

  const pluginsDir = path.join(opencodeDir, "plugins");
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }
  const bundledPlugin = path.join(distDir, "oh-my-irving.plugin.js");
  if (existsSync(bundledPlugin)) {
    cpSync(bundledPlugin, path.join(pluginsDir, "oh-my-irving.plugin.js"));
    console.log(`Installed plugin to ${pluginsDir}`);
  }

  const irvingDir = path.join(opencodeDir, "irving");
  mkdirSync(irvingDir, { recursive: true });
  console.log(`Created irving base directory at ${irvingDir}`);

  console.log("\nDone! Run 'oh-my-irving run . \"your task\"' to start.");

} else if (command === "run") {
  const repo = args[0] ?? process.cwd();
  const taskDescription = args.slice(1).join(" ").trim();
  const maxIterations = Number(process.env.AGENT_MAX_ITERATIONS ?? 100);

  if (!taskDescription) {
    console.error("Usage: oh-my-irving run [path] \"task description\"");
    process.exit(1);
  }

  const sessionId = newSessionId();
  console.log(`Session: ${sessionId}`);
  console.log(`Task: ${taskDescription}\n`);

  // Phase 1: Discover
  console.log("=== Discovery ===\n");
  let code = run(repo, [
    "run", "--dir", repo,
    "--command", "discover",
    taskDescription,
  ], sessionId);
  if (code !== 0) {
    console.error(`Discover failed (exit ${code})`);
    process.exit(code);
  }

  // Phase 2: Debate loop (planning with human gate)
  console.log("\n=== Planning ===\n");

  for (let round = 0; round < 20; round++) {
    code = run(repo, [
      "run", "--dir", repo,
      "--command", "debate",
    ], sessionId);
    if (code !== 0) {
      console.error(`Debate failed (exit ${code})`);
      process.exit(code);
    }

    // Check if plan.json exists and is approved
    const planPath = path.join(repo, ".opencode", "irving", sessionId, "plan.json");
    if (!existsSync(planPath)) {
      // Plan not created yet — ask human for more input
      const answer = await askHuman("Architect/Skeptic need more direction. Provide more context (or 'continue' to let them proceed)?");
      if (answer && answer !== "continue") {
        code = run(repo, [
          "run", "--dir", repo,
          "--command", "resume-after-human",
          answer,
        ], sessionId);
        if (code !== 0) process.exit(code);
      }
      continue;
    }

    const plan = JSON.parse(await readFile(planPath, "utf8"));
    if (plan.human_approval?.status === "approved") {
      console.log("\nPlan approved. Starting execution...\n");
      break;
    }

    // Plan exists but not approved — ask human
    console.log(`\nPlan objective: ${plan.objective ?? "(no objective)"}`);
    const answer = await askHuman("Review the plan. Approve? (yes / provide feedback)");
    if (answer.toLowerCase() === "yes" || answer.toLowerCase() === "y") {
      plan.human_approval = { status: "approved" };
      await writeFile(planPath, JSON.stringify(plan, null, 2) + "\n", "utf8");
      console.log("\nPlan approved. Starting execution...\n");
      break;
    } else {
      code = run(repo, [
        "run", "--dir", repo,
        "--command", "resume-after-human",
        answer,
      ], sessionId);
      if (code !== 0) process.exit(code);
    }
  }

  // Phase 3: Execution loop
  console.log("=== Execution ===\n");

  async function hasEvidenceForAllACs() {
    const plan = await readPlan(repo, sessionId);
    const state = await readState(repo, sessionId);
    const evidence = state.execution?.evidence ?? [];
    return plan.acceptance_criteria.every((ac) =>
      evidence.some((e) => e.ac_id === ac.id)
    );
  }

  for (let i = 0; i < maxIterations; i++) {
    console.log(`\n--- Iteration ${i + 1}/${maxIterations} ---\n`);

    code = run(repo, [
      "run", "--dir", repo,
      "--command", "orchestrate-step",
    ], sessionId);

    if (code !== 0) {
      console.error(`opencode exited with status ${code}`);
      process.exit(code);
    }

    const state = await readState(repo, sessionId);
    const action = state.execution?.next_action;

    console.log(`\nnext_action = ${action}`);
    console.log(`reason = ${state.execution?.reason ?? ""}`);

    if (action === "continue") continue;

    if (action === "ready_for_final_review") {
      console.log("\nRunning final review...\n");
      code = run(repo, [
        "run", "--dir", repo,
        "--command", "final-review",
      ], sessionId);
      if (code !== 0) process.exit(code);
      continue;
    }

    if (action === "needs_human") {
      const question = state.execution?.blocking_question ?? "Input needed.";
      const answer = await askHuman(question);
      if (!answer) {
        console.error("No input provided. Exiting.");
        process.exit(2);
      }
      code = run(repo, [
        "run", "--dir", repo,
        "--command", "resume-after-human",
        answer,
      ], sessionId);
      if (code !== 0) process.exit(code);
      continue;
    }

    if (action === "accepted") {
      if (!(await hasEvidenceForAllACs())) {
        console.error("Refusing to accept: not all acceptance criteria have evidence.");
        process.exit(6);
      }
      console.log("\nAccepted. Orchestration complete.");
      process.exit(0);
    }

    if (action === "blocked" || action === "failed") {
      console.error(`\nStopped: ${action}`);
      console.error(state.execution?.reason ?? "");
      process.exit(3);
    }

    console.error(`Unknown next_action: ${action}`);
    process.exit(4);
  }

  console.error(`Reached AGENT_MAX_ITERATIONS=${maxIterations}`);
  process.exit(5);

} else if (command === "loop") {
  // Legacy: resume an existing session by id
  const repo = args[0] ?? process.cwd();
  const sessionId = args[1] ?? null;
  const maxIterations = Number(process.env.AGENT_MAX_ITERATIONS ?? 100);

  if (!sessionId) {
    console.error("Usage: oh-my-irving loop [path] <session_id>");
    console.error("Use 'oh-my-irving run [path] \"task\"' to start a new session.");
    process.exit(1);
  }

  async function hasEvidenceForAllACs() {
    const plan = await readPlan(repo, sessionId);
    const state = await readState(repo, sessionId);
    const evidence = state.execution?.evidence ?? [];
    return plan.acceptance_criteria.every((ac) =>
      evidence.some((e) => e.ac_id === ac.id)
    );
  }

  for (let i = 0; i < maxIterations; i++) {
    console.log(`\n--- Iteration ${i + 1}/${maxIterations} (session: ${sessionId}) ---\n`);

    const code = run(repo, [
      "run", "--dir", repo,
      "--command", "orchestrate-step",
    ], sessionId);

    if (code !== 0) {
      console.error(`opencode exited with status ${code}`);
      process.exit(code);
    }

    const state = await readState(repo, sessionId);
    const action = state.execution?.next_action;

    console.log(`\nnext_action = ${action}`);
    console.log(`reason = ${state.execution?.reason ?? ""}`);

    if (action === "continue") continue;

    if (action === "ready_for_final_review") {
      console.log("\nRunning final review...\n");
      const reviewCode = run(repo, [
        "run", "--dir", repo,
        "--command", "final-review",
      ], sessionId);
      if (reviewCode !== 0) process.exit(reviewCode);
      continue;
    }

    if (action === "needs_human") {
      console.error("\nHuman input required:");
      console.error(state.execution?.blocking_question ?? "(no question recorded)");
      process.exit(2);
    }

    if (action === "accepted") {
      if (!(await hasEvidenceForAllACs())) {
        console.error("Refusing to accept: not all acceptance criteria have evidence.");
        process.exit(6);
      }
      console.log("\nAccepted. Orchestration complete.");
      process.exit(0);
    }

    if (action === "blocked" || action === "failed") {
      console.error(`\nStopped: ${action}`);
      console.error(state.execution?.reason ?? "");
      process.exit(3);
    }

    console.error(`Unknown next_action: ${action}`);
    process.exit(4);
  }

  console.error(`Reached AGENT_MAX_ITERATIONS=${maxIterations}`);
  process.exit(5);

} else {
  console.log("oh-my-irving — multi-agent orchestration for OpenCode\n");
  console.log("Usage:");
  console.log("  oh-my-irving init [path]                    Scaffold agents and commands into .opencode/");
  console.log("  oh-my-irving run [path] \"task description\"   Full pipeline: discover → plan → execute");
  console.log("  oh-my-irving loop [path] <session_id>       Resume execution loop for existing session");
  process.exit(command ? 1 : 0);
}
