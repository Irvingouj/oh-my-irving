import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

function irvingBaseDir(root: string) {
  return path.join(root, ".opencode", "irving");
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

      await appendJsonl(worktree, "tool-calls.jsonl", {
        type: "tool.before",
        tool: toolName,
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

    // Command templates use OpenCode's documented !`shell output` syntax to read
    // OPENCODE_SESSION_ID. This hook is what makes the current TUI session visible
    // to those shell snippets.
    "shell.env": async (input: { cwd: string; sessionID?: string; callID?: string }, output: { env: Record<string, string> }) => {
      if (input.sessionID) {
        output.env.OPENCODE_SESSION_ID = input.sessionID;
      }
    },
  };
}
