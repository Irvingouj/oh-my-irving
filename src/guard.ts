import { mkdir, appendFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

function irvingBaseDir(root: string) {
  return path.join(root, ".opencode", "irving");
}

function sessionAnchorPath(root: string) {
  return path.join(irvingBaseDir(root), ".active-session.json");
}

async function assertSessionConsistent(worktree: string, sessionID: string) {
  if (!sessionID) {
    throw new Error("OpenCode TUI did not provide sessionID.");
  }

  const base = irvingBaseDir(worktree);
  await mkdir(base, { recursive: true });

  const file = sessionAnchorPath(worktree);
  const now = new Date().toISOString();
  if (!existsSync(file)) {
    await writeFile(
      file,
      JSON.stringify(
        {
          version: 1,
          root_session_id: sessionID,
          child_session_ids: [],
          created_at: now,
          updated_at: now,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    return;
  }

  const anchor = JSON.parse(await readFile(file, "utf8")) as {
    session_id?: string;
    root_session_id: string;
    child_session_ids?: string[];
    created_at?: string;
    updated_at?: string;
  };
  const rootSessionId = anchor.root_session_id || anchor.session_id;
  if (!rootSessionId) {
    throw new Error(`Invalid Irving session anchor at ${file}: missing root_session_id.`);
  }
  const childSessionIds = anchor.child_session_ids ?? [];
  if (sessionID !== rootSessionId && !childSessionIds.includes(sessionID)) {
    childSessionIds.push(sessionID);
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
}

async function appendJsonl(worktree: string, name: string, data: Record<string, unknown>) {
  const dir = path.join(irvingBaseDir(worktree), "logs");
  await mkdir(dir, { recursive: true });
  await appendFile(
    path.join(dir, name),
    JSON.stringify({ at: new Date().toISOString(), ...data }) + "\n",
    "utf8",
  );
}

function isProtectedFile(filePath: string): boolean {
  // Match .opencode/irving/<any_session>/state.json or plan.json
  return /\.opencode\/irving\/[^/]+\/(state|plan)\.json/.test(filePath);
}

export function createGuardHooks(worktree: string) {
  return {
    event: async ({ event }: { event: { type: string; [key: string]: unknown } }) => {
      if (
        event.type === "session.created" ||
        event.type === "session.idle" ||
        event.type === "session.error" ||
        event.type === "session.status"
      ) {
        await appendJsonl(worktree, "opencode-events.jsonl", {
          type: event.type,
          event,
        });
      }
    },

    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }) => {
      const toolName = input.tool;
      const isWrite = toolName === "edit" || toolName === "write";
      const sessionID = input.sessionID;
      await assertSessionConsistent(worktree, sessionID);

      await appendJsonl(worktree, "tool-calls.jsonl", {
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
      await appendJsonl(worktree, "tool-calls.jsonl", {
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
