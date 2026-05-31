import { readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  sessionAnchorPath,
  assertSessionConsistent,
  ensureDirs,
  logsDir,
  debateDir,
} from "./session.js";
import { readStateFile, logEvent } from "./state.js";

async function resolveGuardSessionId(worktree: string, sessionID?: string): Promise<string | undefined> {
  if (sessionID) return sessionID;

  const file = sessionAnchorPath(worktree);
  if (!existsSync(file)) return undefined;

  const anchor = JSON.parse(await readFile(file, "utf8")) as {
    root_session_id?: string;
    session_id?: string;
  };
  return anchor.root_session_id || anchor.session_id;
}

function isProtectedFile(filePath: string): boolean {
  return /\.opencode\/irving\/[^/]+\/(state|plan)\.json/.test(filePath);
}

// --- Anti-loop detection ---

const WINDOW_SIZE = 8;
const SAME_TOOL_AND_ARGS_LIMIT = 3;
const SAME_TOOL_LIMIT = 4;
const SAME_TOOL_WHITELIST = new Set(["bash", "read", "write", "edit", "glob", "grep", "list"]);

type ToolCall = { tool: string; argsHash: string };

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return "[Circular]";
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(normalize);
    const obj = v as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalize(obj[key]);
        return acc;
      }, {});
  };
  return JSON.stringify(normalize(value));
}

const IDENTICAL_MESSAGES = [
  // Strike 1
  (tool: string, summary: string) =>
    [
      "[anti-loop] You are repeating yourself.",
      "",
      `You just called ${tool} with the exact same arguments. Doing the same thing and expecting different results is not a strategy.`,
      `Args: ${summary}`,
      "",
      "Reconsider your approach. Try something different.",
    ].join("\n"),
  // Strike 2
  (tool: string, summary: string) =>
    [
      "[anti-loop] You are STILL repeating the same call. This is the second warning.",
      "",
      `Tool: ${tool}`,
      `Args: ${summary}`,
      "",
      "You ignored the first warning. That was a mistake. This call is not going to work no matter how many times you retry it.",
      "STOP. Read the situation. Ask the user for help if you're stuck.",
    ].join("\n"),
  // Strike 3
  (tool: string, summary: string) =>
    [
      "[anti-loop] THIRD WARNING. You have now tried this exact same call three times after being told to stop.",
      "",
      `Tool: ${tool}`,
      `Args: ${summary}`,
      "",
      "This is not working. It will never work. You are wasting the user's time and tokens.",
      "You MUST either: (1) ask the user what to do, or (2) pick a completely different approach.",
      "Do NOT retry this call.",
    ].join("\n"),
];

const SAME_TOOL_MESSAGES = [
  (tool: string, count: number) =>
    [
      `[anti-loop] You've called ${tool} ${count} times in a row with different arguments but the same tool.`,
      "",
      "Are you making progress, or just thrashing? If you're stuck, ask the user.",
    ].join("\n"),
  (tool: string, count: number) =>
    [
      `[anti-loop] ${tool} again? That's ${count} consecutive calls. Second warning.`,
      "",
      "You're not thinking — you're just trying variations blindly. Stop and actually reason about what's wrong.",
    ].join("\n"),
  (tool: string, count: number) =>
    [
      `[anti-loop] ${tool} called ${count} times now. You are clearly stuck in a loop.`,
      "",
      "Retrying with slightly different arguments is not problem-solving. You need to step back and rethink entirely, or ask the user for guidance.",
    ].join("\n"),
];

function checkAntiLoop(recent: ToolCall[], tool: string, args: Record<string, unknown>): void {
  const argsHash = stableStringify(args);

  // Count consecutive identical calls (same tool + same args) at the tail
  let identicalRun = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].tool === tool && recent[i].argsHash === argsHash) identicalRun++;
    else break;
  }

  if (identicalRun >= 1 && identicalRun <= IDENTICAL_MESSAGES.length) {
    const summary = JSON.stringify(args);
    const msgFn = IDENTICAL_MESSAGES[Math.min(identicalRun - 1, IDENTICAL_MESSAGES.length - 1)];
    throw new Error(msgFn(tool, summary.length > 500 ? summary.slice(0, 500) + "..." : summary));
  }
  if (identicalRun > IDENTICAL_MESSAGES.length) {
    throw new Error(`[anti-loop] BLOCKED. ${tool} called ${identicalRun + 1} times with identical args. Ask the user.`);
  }

  // Count consecutive same-tool calls (any args) at the tail
  let sameToolRun = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].tool === tool) sameToolRun++;
    else break;
  }

  if (sameToolRun >= SAME_TOOL_LIMIT && !SAME_TOOL_WHITELIST.has(tool)) {
    const msgIdx = Math.min(sameToolRun - SAME_TOOL_LIMIT, SAME_TOOL_MESSAGES.length - 1);
    const msgFn = SAME_TOOL_MESSAGES[msgIdx];
    throw new Error(msgFn(tool, sameToolRun + 1));
  }
}

const AWAITING_HUMAN_MESSAGE = [
  "[irving] HUMAN_REPLY_NOT_DETECTED!",
  "",
  "You are trying to approve/accept without a human reply since the last state transition.",
  "YOU CANNOT MOVE FORWARD WITHOUT HUMAN REPLY.",
  "STOP CALLING ANY TOOLS IMMEDIATELY.",
  "STOP GENERATING JSON OR TOOL CALLS.",
  "OUTPUT PLAIN TEXT TO THE HUMAN AND WAIT FOR THEIR REPLY.",
].join("\n");

export function createGuardHooks(worktree: string) {
  const recentToolCalls: ToolCall[] = [];
  // Human reply tracking: count user messages vs last approved count per session
  const humanMessageCount = new Map<string, number>();
  const lastApprovedAtCount = new Map<string, number>();

  const CRITICAL_ACTIONS = new Set(["accepted", "ready_for_final_review"]);
  const CRITICAL_PHASES = new Set(["accepted", "final_review"]);

  return {
    event: async ({ event }: { event: { type: string;[key: string]: unknown } }) => {
      const sessionId = await resolveGuardSessionId(
        worktree,
        (event.session_id as string) || (event.sessionID as string),
      );
      if (!sessionId) return;

      if (
        event.type === "session.created" ||
        event.type === "session.idle" ||
        event.type === "session.error" ||
        event.type === "session.status"
      ) {
        await logEvent(worktree, sessionId, { type: event.type, event });
      }
    },

    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }) => {
      const toolName = input.tool;
      const isWrite = toolName === "edit" || toolName === "write";
      const sessionID = input.sessionID;
      await assertSessionConsistent(worktree, sessionID);

      // Anti-loop detection — always track, even blocked attempts advance the counter
      try {
        checkAntiLoop(recentToolCalls, toolName, output.args ?? {});
      } finally {
        recentToolCalls.push({ tool: toolName, argsHash: stableStringify(output.args ?? {}) });
        while (recentToolCalls.length > WINDOW_SIZE) recentToolCalls.shift();
      }

      // --- Human reply gate for critical transitions ---
      const isCriticalAction = toolName === "irving_next" && CRITICAL_ACTIONS.has(output.args?.action as string);
      const isCriticalPhase = toolName === "irving_advance" && CRITICAL_PHASES.has(output.args?.to as string);

      if (isCriticalAction || isCriticalPhase) {
        const humanCount = humanMessageCount.get(sessionID) ?? 0;
        const lastApproved = lastApprovedAtCount.get(sessionID) ?? 0;
        if (humanCount <= lastApproved) {
          await logEvent(worktree, sessionID, { type: "guard.blocked_no_human_reply", tool: toolName, args: output.args });
          throw new Error(AWAITING_HUMAN_MESSAGE);
        }
        lastApprovedAtCount.set(sessionID, humanCount);
        await logEvent(worktree, sessionID, { type: "guard.critical_transition_approved", tool: toolName, humanCount });
      }

      await logEvent(worktree, sessionID, {
        type: "tool.before",
        tool: toolName,
        session_id: sessionID,
        args: output.args,
      });

      if (!isWrite) return;

      const filePath =
        typeof output.args?.filePath === "string"
          ? output.args.filePath
          : typeof output.args?.path === "string"
            ? output.args.path
            : "";

      if (isProtectedFile(filePath) && !toolName.startsWith("pipeline_")) {
        throw new Error(`Modify ${path.basename(filePath)} through pipeline_* tools only.`);
      }
    },

    "tool.execute.after": async (input: { tool: string; sessionID: string; callID: string; args: unknown }, output: { title: string; output: string; metadata: unknown }) => {
      await logEvent(worktree, input.sessionID, {
        type: "tool.after",
        tool: input.tool,
        output,
      });
    },

    // --- Human reply detector: count user messages and auto-record to debate ---
    "chat.message": async (input: { sessionID: string; agent?: string }, output: { message: { role: string }; parts: Array<{ type: string; text?: string }> }) => {
      const sessionId = input.sessionID;

      // Only react to user messages
      if (output.message.role !== "user") return;

      // Increment human message counter
      const current = humanMessageCount.get(sessionId) ?? 0;
      humanMessageCount.set(sessionId, current + 1);
      await logEvent(worktree, sessionId, { type: "guard.human_reply_detected", count: current + 1 });

      // Extract text and auto-record to debate file
      const textParts = output.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof (p as { text?: string }).text === "string")
        .map(p => p.text);
      const text = textParts.join("\n");
      if (!text.trim()) return;

      try {
        const state = await readStateFile(worktree, sessionId);
        const fileName = `round-${String(state.planning.round).padStart(3, "0")}-human.md`;
        await appendFile(path.join(debateDir(worktree, sessionId), fileName), text + "\n\n", "utf8");
        await logEvent(worktree, sessionId, { type: "guard.human_context_auto_recorded", file: fileName });
      } catch {
        // If state/debate dir doesn't exist yet, just skip recording
      }
    },

    // Keep shell tools aware of the current OpenCode session.
    "shell.env": async (input: { cwd: string; sessionID?: string; callID?: string }, output: { env: Record<string, string> }) => {
      if (input.sessionID) {
        output.env.OPENCODE_SESSION_ID = input.sessionID;
      }
    },
  };
}
