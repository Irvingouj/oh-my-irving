import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  sessionAnchorPath,
  assertSessionConsistent,
} from "./session.js";
import { logEvent } from "./state.js";

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
const SAME_TOOL_AND_ARGS_LIMIT = 2;
const SAME_TOOL_LIMIT = 4;

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

function checkAntiLoop(recent: ToolCall[], tool: string, args: Record<string, unknown>): void {
  const argsHash = stableStringify(args);

  // Count consecutive identical calls (same tool + same args) at the tail
  let identicalRun = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].tool === tool && recent[i].argsHash === argsHash) identicalRun++;
    else break;
  }

  if (identicalRun >= SAME_TOOL_AND_ARGS_LIMIT) {
    const summary = JSON.stringify(args);
    throw new Error(
      [
        "[anti-loop] Repeated identical tool call detected.",
        "",
        `Tool: ${tool}`,
        `Repeated: ${identicalRun + 1} times`,
        `Args: ${summary.length > 500 ? summary.slice(0, 500) + "..." : summary}`,
        "",
        "Do not retry the same tool call. Stop and ask the user, or choose a different strategy.",
      ].join("\n"),
    );
  }

  // Count consecutive same-tool calls (any args) at the tail
  let sameToolRun = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].tool === tool) sameToolRun++;
    else break;
  }

  if (sameToolRun >= SAME_TOOL_LIMIT) {
    throw new Error(
      [
        "[anti-loop] Possible tool-use loop detected.",
        "",
        `Tool: ${tool}`,
        `Consecutive calls: ${sameToolRun + 1}`,
        "",
        "You keep calling the same tool. Pause and reconsider, or ask the user.",
      ].join("\n"),
    );
  }
}

export function createGuardHooks(worktree: string) {
  const recentToolCalls: ToolCall[] = [];

  return {
    event: async ({ event }: { event: { type: string; [key: string]: unknown } }) => {
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

      // Anti-loop check before logging/allowing the call
      checkAntiLoop(recentToolCalls, toolName, output.args ?? {});

      recentToolCalls.push({ tool: toolName, argsHash: stableStringify(output.args ?? {}) });
      while (recentToolCalls.length > WINDOW_SIZE) recentToolCalls.shift();

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

    // Keep shell tools aware of the current OpenCode session.
    "shell.env": async (input: { cwd: string; sessionID?: string; callID?: string }, output: { env: Record<string, string> }) => {
      if (input.sessionID) {
        output.env.OPENCODE_SESSION_ID = input.sessionID;
      }
    },
  };
}
