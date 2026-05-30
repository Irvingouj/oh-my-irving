import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";

type Phase = "init" | "discovery" | "planning" | "execution" | "final_review" | "accepted" | "blocked";

type NextAction = "continue" | "needs_human" | "ready_for_final_review" | "accepted" | "blocked" | "failed";

type State = {
  version: 1;
  session_id: string;
  phase: Phase;
  planning: {
    status: string;
    round: number;
  };
  execution: {
    status: string;
    iteration: number;
    next_action: NextAction;
    reason: string;
    blocking_question: string | null;
    last_error: string | null;
    active_work_units: string[];
    blocked_work_units: string[];
    ignored_findings: Array<{
      finding_id: string;
      reason: string;
    }>;
    evidence: Array<{
      ac_id: string;
      type: "test" | "review" | "manual" | "static";
      detail: string;
    }>;
  };
};

type SessionAnchor = {
  version: 1;
  root_session_id: string;
  child_session_ids: string[];
  created_at: string;
  updated_at: string;
  session_id?: string;
};

function irvingBaseDir(root: string) {
  return path.join(root, ".opencode", "irving");
}

function sessionDir(root: string, sessionId: string) {
  return path.join(irvingBaseDir(root), sessionId);
}

function sessionAnchorPath(root: string) {
  return path.join(irvingBaseDir(root), ".active-session.json");
}

function statePath(root: string, sessionId: string) {
  return path.join(sessionDir(root, sessionId), "state.json");
}

async function ensureDirs(root: string, sessionId: string) {
  const base = sessionDir(root, sessionId);
  for (const dir of [
    base,
    path.join(base, "debate"),
    path.join(base, "work-units"),
    path.join(base, "reports"),
    path.join(base, "reviews"),
    path.join(base, "logs"),
  ]) {
    await mkdir(dir, { recursive: true });
  }
}

async function readStateFile(root: string, sessionId: string): Promise<State> {
  await ensureDirs(root, sessionId);
  const file = statePath(root, sessionId);
  if (!existsSync(file)) {
    return {
      version: 1,
      session_id: sessionId,
      phase: "init",
      planning: { status: "not_started", round: 0 },
      execution: {
        status: "not_started",
        iteration: 0,
        next_action: "continue",
        reason: "",
        blocking_question: null,
        last_error: null,
        active_work_units: [],
        blocked_work_units: [],
        ignored_findings: [],
        evidence: [],
      },
    };
  }
  return JSON.parse(await readFile(file, "utf8")) as State;
}

async function writeStateFile(root: string, sessionId: string, state: State) {
  await ensureDirs(root, sessionId);
  await writeFile(statePath(root, sessionId), JSON.stringify(state, null, 2) + "\n", "utf8");
}

async function logEvent(root: string, sessionId: string, event: Record<string, unknown>) {
  await ensureDirs(root, sessionId);
  await appendFile(
    path.join(sessionDir(root, sessionId), "logs", "events.jsonl"),
    JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
    "utf8",
  );
}

function sessionIdArg() {
  return tool.schema.string().optional().describe("Session ID. Defaults to the current OpenCode session.");
}

async function currentSessionId(root: string, context: ToolContext, requestedSessionId?: string | null): Promise<string> {
  const contextSessionId = context.sessionID;
  if (!contextSessionId) {
    throw new Error("OpenCode TUI did not provide context.sessionID.");
  }

  const base = irvingBaseDir(root);
  await mkdir(base, { recursive: true });

  const file = sessionAnchorPath(root);
  const now = new Date().toISOString();
  if (!existsSync(file)) {
    const rootSessionId = requestedSessionId || contextSessionId;
    const anchor: SessionAnchor = {
      version: 1,
      root_session_id: rootSessionId,
      child_session_ids: contextSessionId === rootSessionId ? [] : [contextSessionId],
      created_at: now,
      updated_at: now,
    };
    await writeFile(file, JSON.stringify(anchor, null, 2) + "\n", "utf8");
    return rootSessionId;
  }

  const anchor = JSON.parse(await readFile(file, "utf8")) as SessionAnchor;
  const rootSessionId = anchor.root_session_id || anchor.session_id;
  if (!rootSessionId) {
    throw new Error(`Invalid Irving session anchor at ${file}: missing root_session_id.`);
  }
  if (requestedSessionId && requestedSessionId !== rootSessionId) {
    throw new Error(
      `Irving session mismatch. Expected root session ${rootSessionId}, got requested session ${requestedSessionId}.`,
    );
  }

  const childSessionIds = anchor.child_session_ids ?? [];
  if (contextSessionId !== rootSessionId && !childSessionIds.includes(contextSessionId)) {
    childSessionIds.push(contextSessionId);
  }

  await writeFile(
    file,
    JSON.stringify(
      {
        version: 1,
        root_session_id: rootSessionId,
        child_session_ids: childSessionIds,
        created_at: anchor.created_at ?? now,
        updated_at: now,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return rootSessionId;
}

async function resolveSessionId(root: string, args: { session_id?: string | null }, context: ToolContext): Promise<string> {
  return await currentSessionId(root, context, args.session_id);
}

export function createPipelineTools(worktree: string): Record<string, ToolDefinition> {
  return {
    irving_session: tool({
      description: "Return the current OpenCode session id and Irving artifact directory.",
      args: {
        session_id: sessionIdArg(),
      },
      async execute(args, context) {
        const sessionId = await currentSessionId(worktree, context, args.session_id);
        await ensureDirs(worktree, sessionId);
        return JSON.stringify({
          session_id: sessionId,
          base_path: `.opencode/irving/${sessionId}`,
        });
      },
    }),

    pipeline_init: tool({
      description: "Initialize pipeline state for the current OpenCode session. Returns the session ID.",
      args: {},
      async execute(_args, context) {
        const sessionId = await currentSessionId(worktree, context);
        const state = await readStateFile(worktree, sessionId);
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.init" });
        return `Session ${sessionId} initialized. Path: .opencode/irving/${sessionId}/`;
      },
    }),

    pipeline_read_state: tool({
      description: "Read state.json for a session.",
      args: {
        session_id: sessionIdArg(),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        return JSON.stringify(await readStateFile(worktree, sessionId), null, 2);
      },
    }),

    pipeline_set_phase: tool({
      description: "Set top-level pipeline phase.",
      args: {
        session_id: sessionIdArg(),
        phase: tool.schema.enum(["init", "discovery", "planning", "execution", "final_review", "accepted", "blocked"]),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        const state = await readStateFile(worktree, sessionId);
        state.phase = args.phase;
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.phase", phase: args.phase });
        return `Phase set to ${args.phase}`;
      },
    }),

    pipeline_set_planning_status: tool({
      description: "Set planning sub-status and increment round if needed.",
      args: {
        session_id: sessionIdArg(),
        status: tool.schema.string().describe("New planning status"),
        increment_round: tool.schema.boolean().default(false).describe("Whether to increment the debate round"),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        const state = await readStateFile(worktree, sessionId);
        state.planning.status = args.status;
        if (args.increment_round) state.planning.round += 1;
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.planning_status", status: args.status, round: state.planning.round });
        return `Planning status set to ${args.status} (round ${state.planning.round})`;
      },
    }),

    pipeline_set_execution_status: tool({
      description: "Set execution sub-status and optionally increment iteration.",
      args: {
        session_id: sessionIdArg(),
        status: tool.schema.string().describe("New execution status"),
        increment_iteration: tool.schema.boolean().default(false).describe("Whether to increment the iteration counter"),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        const state = await readStateFile(worktree, sessionId);
        state.execution.status = args.status;
        if (args.increment_iteration) state.execution.iteration += 1;
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.execution_status", status: args.status, iteration: state.execution.iteration });
        return `Execution status set to ${args.status} (iteration ${state.execution.iteration})`;
      },
    }),

    pipeline_record_evidence: tool({
      description: "Record evidence for an acceptance criterion.",
      args: {
        session_id: sessionIdArg(),
        ac_id: tool.schema.string().describe("Acceptance criterion ID"),
        type: tool.schema.enum(["test", "review", "manual", "static"]),
        detail: tool.schema.string().describe("What evidence was observed"),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        const state = await readStateFile(worktree, sessionId);
        state.execution.evidence.push({ ac_id: args.ac_id, type: args.type, detail: args.detail });
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.evidence", ac_id: args.ac_id, evidence_type: args.type, detail: args.detail });
        return `Recorded evidence for ${args.ac_id}`;
      },
    }),

    pipeline_ignore_finding: tool({
      description: "Record that the orchestrator ignored a reviewer finding with reason.",
      args: {
        session_id: sessionIdArg(),
        finding_id: tool.schema.string().describe("ID of the ignored finding"),
        reason: tool.schema.string().describe("Why it was ignored"),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        const state = await readStateFile(worktree, sessionId);
        state.execution.ignored_findings.push({ finding_id: args.finding_id, reason: args.reason });
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.ignore_finding", finding_id: args.finding_id, reason: args.reason });
        return `Ignored finding ${args.finding_id}`;
      },
    }),

    pipeline_set_active_work_units: tool({
      description: "Set the list of currently active work unit IDs.",
      args: {
        session_id: sessionIdArg(),
        ids: tool.schema.array(tool.schema.string()).describe("Work unit IDs"),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        const state = await readStateFile(worktree, sessionId);
        state.execution.active_work_units = args.ids;
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.active_wu", ids: args.ids });
        return `Active work units: ${args.ids.join(", ") || "none"}`;
      },
    }),

    pipeline_set_blocked_work_units: tool({
      description: "Set the list of currently blocked work unit IDs.",
      args: {
        session_id: sessionIdArg(),
        ids: tool.schema.array(tool.schema.string()).describe("Work unit IDs"),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        const state = await readStateFile(worktree, sessionId);
        state.execution.blocked_work_units = args.ids;
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.blocked_wu", ids: args.ids });
        return `Blocked work units: ${args.ids.join(", ") || "none"}`;
      },
    }),

    pipeline_create_plan: tool({
      description: "Create or overwrite plan.json for a session. Use this instead of writing plan.json directly.",
      args: {
        session_id: sessionIdArg(),
        plan: tool.schema.string().describe("JSON string of the plan object"),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        await ensureDirs(worktree, sessionId);
        const file = path.join(sessionDir(worktree, sessionId), "plan.json");
        await writeFile(file, args.plan, "utf8");
        await logEvent(worktree, sessionId, { type: "pipeline.plan_created" });
        return `Wrote ${file}`;
      },
    }),

    pipeline_read_plan: tool({
      description: "Read plan.json for a session.",
      args: {
        session_id: sessionIdArg(),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        await ensureDirs(worktree, sessionId);
        const file = path.join(sessionDir(worktree, sessionId), "plan.json");
        if (!existsSync(file)) {
          return "plan.json does not exist yet";
        }
        return await readFile(file, "utf8");
      },
    }),

    pipeline_create_work_unit_file: tool({
      description: "Create or overwrite a work unit markdown file.",
      args: {
        session_id: sessionIdArg(),
        id: tool.schema.string().describe("Work unit ID"),
        content: tool.schema.string().describe("Markdown content"),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        await ensureDirs(worktree, sessionId);
        const file = path.join(sessionDir(worktree, sessionId), "work-units", `${args.id}.md`);
        await writeFile(file, args.content, "utf8");
        await logEvent(worktree, sessionId, { type: "pipeline.work_unit.created", id: args.id });
        return `Wrote ${file}`;
      },
    }),

    pipeline_append_human_context: tool({
      description: "Append human-supplied context into the current debate round.",
      args: {
        session_id: sessionIdArg(),
        round: tool.schema.number().describe("Debate round number"),
        content: tool.schema.string().describe("Human context"),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        await ensureDirs(worktree, sessionId);
        const name = `round-${String(args.round).padStart(3, "0")}-human.md`;
        const file = path.join(sessionDir(worktree, sessionId), "debate", name);
        await appendFile(file, args.content + "\n\n", "utf8");
        await logEvent(worktree, sessionId, { type: "pipeline.human_context", round: args.round });
        return `Appended human context to ${file}`;
      },
    }),

    pipeline_record_decision: tool({
      description: "Record an orchestrator decision with reasoning.",
      args: {
        session_id: sessionIdArg(),
        decision: tool.schema.string().describe("What was decided"),
        reasoning: tool.schema.string().describe("Why"),
        work_unit: tool.schema.string().optional().describe("Related work unit ID"),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        await logEvent(worktree, sessionId, { type: "pipeline.decision", decision: args.decision, reasoning: args.reasoning, work_unit: args.work_unit ?? null });
        return `Recorded decision: ${args.decision}`;
      },
    }),

    pipeline_set_next_action: tool({
      description: "Set the next action for the external orchestration loop. Must be called at end of every orchestrator invocation.",
      args: {
        session_id: sessionIdArg(),
        next_action: tool.schema.enum(["continue", "needs_human", "ready_for_final_review", "accepted", "blocked", "failed"]).describe("What the external runner should do next"),
        reason: tool.schema.string().describe("Why"),
        blocking_question: tool.schema.string().optional().describe("Question for human if needs_human"),
      },
      async execute(args, context) {
        const sessionId = await resolveSessionId(worktree, args, context);
        const state = await readStateFile(worktree, sessionId);
        state.execution.next_action = args.next_action;
        state.execution.reason = args.reason;
        state.execution.blocking_question = args.blocking_question ?? null;
        await writeStateFile(worktree, sessionId, state);
        await logEvent(worktree, sessionId, { type: "pipeline.next_action", next_action: args.next_action, reason: args.reason, iteration: state.execution.iteration });
        return JSON.stringify({ next_action: args.next_action, reason: args.reason, blocking_question: args.blocking_question ?? null, iteration: state.execution.iteration });
      },
    }),
  };
}
