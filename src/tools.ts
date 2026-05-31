import { readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";
import {
  currentSessionId,
  ensureDirs,
  sessionDir,
  debateDir,
  workUnitsDir,
  planPath,
} from "./session.js";
import {
  readStateFile,
  writeStateFile,
  readPlanFile,
  writePlanFile,
  logEvent,
} from "./state.js";
import { validateState, validatePlan } from "./schema.js";

export function parseYamlFrontmatter(content: string): { frontmatter: Record<string, unknown> | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  const frontmatterText = match[1];
  const body = match[2];

  const frontmatter: Record<string, unknown> = {};
  for (const line of frontmatterText.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        frontmatter[key] = JSON.parse(value);
      } catch {
        frontmatter[key] = value;
      }
    } else if (value === "true") {
      frontmatter[key] = true;
    } else if (value === "false") {
      frontmatter[key] = false;
    } else if (!isNaN(Number(value)) && value !== "") {
      frontmatter[key] = Number(value);
    } else {
      frontmatter[key] = value.replace(/^["'](.*)["']$/, "$1");
    }
  }

  return { frontmatter, body };
}

export function validateWorkUnitFrontmatter(frontmatter: Record<string, unknown> | null): string | null {
  if (!frontmatter) return null;

  const requiredFields = ["id", "title", "status", "dependencies"];
  for (const field of requiredFields) {
    if (!(field in frontmatter)) {
      return `Missing required frontmatter field: ${field}`;
    }
  }

  if (!Array.isArray(frontmatter.dependencies)) {
    return "Field 'dependencies' must be an array";
  }

  return null;
}

async function autoSessionId(worktree: string, context: ToolContext): Promise<string> {
  return await currentSessionId(worktree, context);
}


function parseLines(raw: string): string[] {
  return raw.split("\n").map(l => l.trim()).filter(Boolean);
}

// --- In-tool guard state (survives across tool calls within plugin lifecycle) ---

const CRITICAL_ACTIONS = new Set(["accepted", "ready_for_final_review"]);
const CRITICAL_PHASES = new Set(["accepted", "final_review"]);
const IDENTICAL_CALL_LIMIT = 3;
const CALL_LOG_WINDOW = 10;

const nextCallLog = new Map<string, Array<{ action: string; why: string }>>();
const advanceCallLog = new Map<string, Array<{ to: string }>>();

const humanReplyCount = new Map<string, number>();
const lastApprovedAt = new Map<string, number>();

const nonOrchestratorAttempts = new Map<string, number>();

const IDENTICAL_CALL_MESSAGES = [
  (tool: string, args: string, count: number) =>
    [
      `[anti-loop] You called ${tool} with identical arguments ${count} time(s). This call is BLOCKED.`,
      "",
      `Args: ${args}`,
      "",
      "DO NOT CALL THIS TOOL AGAIN WITH THE SAME ARGUMENTS.",
      "DO NOT REPLY WITH ANY JSON OR TOOL CALLS.",
      "",
      "IMMEDIATELY reply with this exact format:",
      `'I HAVE TO STOP HERE! Because I am calling ${tool} with the same arguments repeatedly, which means I am stuck in a loop. I need to change my approach.'`,
      "",
      "Then explain what you will do differently.",
    ].join("\n"),
  (tool: string, args: string, count: number) =>
    [
      `[anti-loop] SECOND BLOCK. You ignored the first warning and called ${tool} ${count} time(s) with identical arguments.`,
      "",
      `Args: ${args}`,
      "",
      "THIS WILL NEVER WORK NO MATTER HOW MANY TIMES YOU RETRY IT.",
      "YOU ARE WASTING THE USER'S TIME AND TOKENS.",
      "",
      "DO NOT CALL ANY TOOLS.",
      "DO NOT REPLY WITH ANY JSON OR TOOL CALLS.",
      "",
      "IMMEDIATELY reply with this exact format:",
      `'I HAVE TO STOP HERE! Because I have been told twice to stop calling ${tool} with the same arguments, and I kept doing it anyway. I need the user to tell me what to do next.'`,
    ].join("\n"),
  (tool: string, args: string, count: number) =>
    [
      `[anti-loop] THIRD AND FINAL BLOCK. You have called ${tool} ${count} time(s) with identical arguments after being told to stop THREE TIMES.`,
      "",
      `Args: ${args}`,
      "",
      "YOU ARE STUCK IN A LOOP AND CANNOT SELF-CORRECT.",
      "STOP ALL TOOL CALLS IMMEDIATELY.",
      "DO NOT GENERATE ANY JSON.",
      "DO NOT CALL ANY TOOLS.",
      "",
      "YOUR ONLY OPTION NOW:",
      `'I HAVE TO STOP HERE! Because I am in an infinite loop calling ${tool} with the same arguments ${count} times despite being blocked each time. I cannot continue without human guidance.'`,
      "",
      "Then wait. Do nothing else.",
    ].join("\n"),
];

const NON_ORCHESTRATOR_MESSAGES = [
  (agent: string, tool: string) =>
    [
      `[irving] BLOCKED. You are agent "${agent}", not the orchestrator. Only the orchestrator can call ${tool}.`,
      "",
      "DO NOT CALL irving_next, irving_advance, irving_plan, irving_delegate, irving_evidence, irving_skip, or irving_note.",
      "DO NOT REPLY WITH ANY JSON OR TOOL CALLS.",
      "",
      "IMMEDIATELY reply with this exact format:",
      `'I HAVE TO STOP HERE! Because I am agent "${agent}", not the orchestrator, and I am not allowed to call ${tool}. I will write my findings to my report file instead.'`,
      "",
      "Then write your findings to your report file and terminate.",
    ].join("\n"),
  (agent: string, tool: string) =>
    [
      `[irving] SECOND BLOCK. You are STILL trying to call ${tool} as agent "${agent}". You are NOT the orchestrator.`,
      "",
      "CALLING THIS TOOL AGAIN WILL NOT CHANGE YOUR ROLE.",
      "DO NOT CALL ANY irving_* TOOLS.",
      "DO NOT REPLY WITH ANY JSON OR TOOL CALLS.",
      "",
      "IMMEDIATELY reply with this exact format:",
      `'I HAVE TO STOP HERE! Because I keep trying to call ${tool} even though I am agent "${agent}", not the orchestrator. I will write my findings to my report file and stop.'`,
    ].join("\n"),
  (agent: string, tool: string) =>
    [
      `[irving] FINAL BLOCK. You have tried to call ${tool} 3 times as agent "${agent}".`,
      "",
      "YOU ARE NOT AND WILL NEVER BE THE ORCHESTRATOR.",
      "STOP ALL TOOL CALLS IMMEDIATELY.",
      "DO NOT GENERATE ANY JSON.",
      "DO NOT CALL ANY TOOLS.",
      "",
      "IMMEDIATELY reply with this exact format:",
      `'I HAVE TO STOP HERE! Because I have been blocked 3 times from calling ${tool} as agent "${agent}" and I cannot self-correct. I need the orchestrator to handle pipeline state.'`,
      "",
      "Then wait. Do nothing else.",
    ].join("\n"),
];

const AWAITING_HUMAN_MESSAGE = [
  "[irving] BLOCKED — NO HUMAN REPLY DETECTED.",
  "",
  "You are trying to approve or accept without receiving a human reply since the last state transition.",
  "YOU CANNOT MOVE FORWARD WITHOUT A HUMAN REPLY. THIS IS A HARD REQUIREMENT.",
  "",
  "DO NOT CALL ANY TOOLS.",
  "DO NOT REPLY WITH ANY JSON OR TOOL CALLS.",
  "DO NOT TRY irving_next WITH A DIFFERENT ACTION.",
  "",
  "IMMEDIATELY reply with this exact format:",
  "'I HAVE TO STOP HERE! Because I tried to approve/accept the pipeline state, but no human has replied since the last state transition. I need explicit human approval before I can proceed.'",
  "",
  "Then wait for the human to reply. Do nothing else.",
].join("\n");

function countIdenticalTail<T>(log: T[], entry: T): number {
  const key = JSON.stringify(entry);
  let count = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    if (JSON.stringify(log[i]) === key) count++;
    else break;
  }
  return count;
}

export function recordHumanReply(sessionId: string): void {
  const current = humanReplyCount.get(sessionId) ?? 0;
  humanReplyCount.set(sessionId, current + 1);
}

function requireOrchestratorGraduated(context: ToolContext, toolName: string): void {
  if (!context.agent || context.agent === "orchestrator") return;

  const key = `${context.sessionID}:${toolName}`;
  const attempts = nonOrchestratorAttempts.get(key) ?? 0;
  nonOrchestratorAttempts.set(key, attempts + 1);

  const msgIdx = Math.min(attempts, NON_ORCHESTRATOR_MESSAGES.length - 1);
  throw new Error(NON_ORCHESTRATOR_MESSAGES[msgIdx](context.agent, toolName));
}

export function createPipelineTools(worktree: string): Record<string, ToolDefinition> {
  return {
    irving_session: tool({
      description: "Get session info. Call once at start. Returns session_id and base_path.",
      args: {},
      async execute(_args, context) {
        const sessionId = await autoSessionId(worktree, context);
        await ensureDirs(worktree, sessionId);
        return JSON.stringify({
          session_id: sessionId,
          base_path: `.opencode/irving/${sessionId}`,
        });
      },
    }),

    irving_status: tool({
      description: "Read current pipeline state and plan in one call.",
      args: {},
      async execute(_args, context) {
        const sessionId = await autoSessionId(worktree, context);
        await ensureDirs(worktree, sessionId);
        const state = await readStateFile(worktree, sessionId);
        const planFile = planPath(worktree, sessionId);
        let plan = null;
        if (existsSync(planFile)) {
          plan = await readPlanFile(worktree, sessionId);
        }
        return JSON.stringify({ state, plan }, null, 2);
      },
    }),

    irving_advance: tool({
      description: 'Move pipeline forward. Use a phase name like "discovery" "planning" "execution" "final_review" "accepted" or "round:N" to bump debate round.',
      args: {
        to: tool.schema.string().describe("Target phase or round:N"),
      },
      async execute(args, context) {
        requireOrchestratorGraduated(context, "irving_advance");
        const sessionId = await autoSessionId(worktree, context);

        // Anti-loop: block identical repeated calls
        const entry = { to: args.to };
        const log = advanceCallLog.get(sessionId) ?? [];
        const identicalRun = countIdenticalTail(log, entry);
        log.push(entry);
        if (log.length > CALL_LOG_WINDOW) log.splice(0, log.length - CALL_LOG_WINDOW);
        advanceCallLog.set(sessionId, log);
        if (identicalRun >= 1) {
          const msgIdx = Math.min(identicalRun - 1, IDENTICAL_CALL_MESSAGES.length - 1);
          throw new Error(IDENTICAL_CALL_MESSAGES[msgIdx]("irving_advance", JSON.stringify(entry), identicalRun + 1));
        }

        // Human reply gate for critical phases
        if (CRITICAL_PHASES.has(args.to)) {
          const humanCount = humanReplyCount.get(sessionId) ?? 0;
          const lastApproved = lastApprovedAt.get(sessionId) ?? 0;
          if (humanCount <= lastApproved) {
            await logEvent(worktree, sessionId, { type: "guard.blocked_no_human_reply", tool: "irving_advance", args });
            throw new Error(AWAITING_HUMAN_MESSAGE);
          }
          lastApprovedAt.set(sessionId, humanCount);
          await logEvent(worktree, sessionId, { type: "guard.critical_transition_approved", tool: "irving_advance", humanCount });
        }

        const state = await readStateFile(worktree, sessionId);
        const target = args.to;

        if (target.startsWith("round:")) {
          const n = parseInt(target.slice(6), 10);
          state.planning.round = n;
          state.planning.status = "debating";
          await writeStateFile(worktree, sessionId, state);
          await logEvent(worktree, sessionId, { type: "pipeline.round", round: n });
          return `Round set to ${n}`;
        }

        const phases = ["init", "discovery", "planning", "execution", "final_review", "accepted", "blocked"];
        if (!phases.includes(target)) {
          return `Unknown phase: ${target}. Valid: ${phases.join(", ")}`;
        }
        state.phase = target as typeof state.phase;
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.phase", phase: target });
        return `Phase set to ${target}`;
      },
    }),

    irving_plan: tool({
      description: "Create the plan. Each arg is a simple string.",
      args: {
        objective: tool.schema.string().describe("One sentence goal"),
        criteria: tool.schema.string().describe("Acceptance criteria, one per line: AC-1: description"),
        units: tool.schema.string().describe("Work units, one per line: wu-1: description (depends: wu-0)"),
      },
      async execute(args, context) {
        requireOrchestratorGraduated(context, "irving_plan");
        const sessionId = await autoSessionId(worktree, context);
        await ensureDirs(worktree, sessionId);

        const acceptance_criteria = parseLines(args.criteria).map(line => {
          const colonIdx = line.indexOf(":");
          if (colonIdx === -1) return { id: `AC-${Date.now()}`, description: line, status: "pending" };
          return { id: line.slice(0, colonIdx).trim(), description: line.slice(colonIdx + 1).trim(), status: "pending" };
        });

        const work_units = parseLines(args.units).map(line => {
          const depMatch = line.match(/\(depends:\s*([^)]+)\)/i);
          const deps = depMatch ? depMatch[1].split(",").map(s => s.trim()) : [];
          const clean = line.replace(/\(depends:[^)]*\)/i, "").trim();
          const colonIdx = clean.indexOf(":");
          if (colonIdx === -1) return { id: `wu-${Date.now()}`, description: clean, status: "pending", dependencies: deps };
          return { id: clean.slice(0, colonIdx).trim(), description: clean.slice(colonIdx + 1).trim(), status: "pending", dependencies: deps };
        });

        const plan = { objective: args.objective, acceptance_criteria, work_units };
        validatePlan(plan);
        await writePlanFile(worktree, sessionId, plan);
        await logEvent(worktree, sessionId, { type: "pipeline.plan_created" });
        return `Plan created with ${acceptance_criteria.length} criteria and ${work_units.length} work units`;
      },
    }),

    irving_work_unit: tool({
      description: "Create a work unit file. The body is the implementation instructions.",
      args: {
        id: tool.schema.string().describe("Work unit ID like wu-1"),
        title: tool.schema.string().describe("Short title"),
        body: tool.schema.string().describe("Description and acceptance criteria"),
      },
      async execute(args, context) {
        requireOrchestratorGraduated(context, "irving_work_unit");
        const sessionId = await autoSessionId(worktree, context);
        await ensureDirs(worktree, sessionId);
        const content = `---\nid: ${args.id}\ntitle: "${args.title}"\nstatus: pending\ndependencies: []\n---\n\n${args.body}`;
        const { frontmatter } = parseYamlFrontmatter(content);
        const validationError = validateWorkUnitFrontmatter(frontmatter);
        if (validationError) {
          return `Error: ${validationError}`;
        }
        const file = path.join(workUnitsDir(worktree, sessionId), `${args.id}.md`);
        await writeFile(file, content, "utf8");
        await logEvent(worktree, sessionId, { type: "pipeline.work_unit.created", id: args.id });
        return `Created work unit ${args.id}`;
      },
    }),

    irving_delegate: tool({
      description: "Set which work units are active and which are blocked.",
      args: {
        active: tool.schema.array(tool.schema.string()).describe("Work unit IDs to activate"),
        blocked: tool.schema.array(tool.schema.string()).describe("Work unit IDs that are blocked"),
      },
      async execute(args, context) {
        requireOrchestratorGraduated(context, "irving_delegate");
        const sessionId = await autoSessionId(worktree, context);
        const state = await readStateFile(worktree, sessionId);
        state.execution.active_work_units = args.active;
        state.execution.blocked_work_units = args.blocked;
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.delegate", active: args.active, blocked: args.blocked });
        return `Active: ${args.active.join(", ") || "none"}. Blocked: ${args.blocked.join(", ") || "none"}`;
      },
    }),

    irving_evidence: tool({
      description: "Record evidence that an acceptance criterion is satisfied.",
      args: {
        ac_id: tool.schema.string().describe("Acceptance criterion ID like AC-1"),
        detail: tool.schema.string().describe("What was verified and how"),
      },
      async execute(args, context) {
        requireOrchestratorGraduated(context, "irving_evidence");
        const sessionId = await autoSessionId(worktree, context);
        const state = await readStateFile(worktree, sessionId);
        state.execution.evidence.push({ ac_id: args.ac_id, type: "review", detail: args.detail });
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.evidence", ac_id: args.ac_id, detail: args.detail });
        return `Evidence recorded for ${args.ac_id}`;
      },
    }),

    irving_skip: tool({
      description: "Skip a reviewer finding with a reason.",
      args: {
        finding_id: tool.schema.string().describe("Finding ID to skip"),
        why: tool.schema.string().describe("Why this finding is being ignored"),
      },
      async execute(args, context) {
        requireOrchestratorGraduated(context, "irving_skip");
        const sessionId = await autoSessionId(worktree, context);
        const state = await readStateFile(worktree, sessionId);
        state.execution.ignored_findings.push({ finding_id: args.finding_id, reason: args.why });
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.skip", finding_id: args.finding_id });
        return `Skipped finding ${args.finding_id}`;
      },
    }),

    irving_note: tool({
      description: "Record a decision, human context, or any note for the audit trail.",
      args: {
        kind: tool.schema.string().describe("Type: decision, human_context, or general"),
        text: tool.schema.string().describe("The note content"),
      },
      async execute(args, context) {
        requireOrchestratorGraduated(context, "irving_note");
        const sessionId = await autoSessionId(worktree, context);
        await ensureDirs(worktree, sessionId);
        if (args.kind === "human_context") {
          const state = await readStateFile(worktree, sessionId);
          const name = `round-${String(state.planning.round).padStart(3, "0")}-human.md`;
          await appendFile(path.join(debateDir(worktree, sessionId), name), args.text + "\n\n", "utf8");
        }
        await logEvent(worktree, sessionId, { type: "pipeline.note", kind: args.kind, text: args.text });
        return `Recorded ${args.kind} note`;
      },
    }),

    irving_next: tool({
      description: "End this iteration. Say what happens next. Use blocked when waiting for human input — then output plain text to the human and wait.",
      args: {
        action: tool.schema.string().describe("continue, ready_for_final_review, accepted, blocked, or failed"),
        why: tool.schema.string().describe("One sentence explaining why"),
      },
      async execute(args, context) {
        requireOrchestratorGraduated(context, "irving_next");
        const sessionId = await autoSessionId(worktree, context);

        // Anti-loop: block identical repeated calls
        const entry = { action: args.action, why: args.why };
        const log = nextCallLog.get(sessionId) ?? [];
        const identicalRun = countIdenticalTail(log, entry);
        log.push(entry);
        if (log.length > CALL_LOG_WINDOW) log.splice(0, log.length - CALL_LOG_WINDOW);
        nextCallLog.set(sessionId, log);
        if (identicalRun >= 1) {
          const msgIdx = Math.min(identicalRun - 1, IDENTICAL_CALL_MESSAGES.length - 1);
          throw new Error(IDENTICAL_CALL_MESSAGES[msgIdx]("irving_next", JSON.stringify(entry), identicalRun + 1));
        }

        // Human reply gate for critical actions
        if (CRITICAL_ACTIONS.has(args.action)) {
          const humanCount = humanReplyCount.get(sessionId) ?? 0;
          const lastApproved = lastApprovedAt.get(sessionId) ?? 0;
          if (humanCount <= lastApproved) {
            await logEvent(worktree, sessionId, { type: "guard.blocked_no_human_reply", tool: "irving_next", args });
            throw new Error(AWAITING_HUMAN_MESSAGE);
          }
          lastApprovedAt.set(sessionId, humanCount);
          await logEvent(worktree, sessionId, { type: "guard.critical_transition_approved", tool: "irving_next", humanCount });
        }

        const state = await readStateFile(worktree, sessionId);
        const valid = ["continue", "ready_for_final_review", "accepted", "blocked", "failed"];
        const action = valid.includes(args.action) ? args.action : "blocked";
        state.execution.next_action = action as typeof state.execution.next_action;
        state.execution.reason = args.why;
        state.execution.blocking_question = action === "blocked" ? args.why : null;
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.next_action", action, why: args.why });
        return `${action}: ${args.why} (iteration ${state.execution.iteration})`;
      },
    }),
  };
}
