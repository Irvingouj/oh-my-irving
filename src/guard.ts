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
  // Match .opencode/irving/<any_session>/(state|plan).json
  return /\.opencode\/irving\/[^/]+\/(state|plan)\.json/.test(filePath);
}

export function createGuardHooks(worktree: string) {
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
