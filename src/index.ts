import type { Plugin } from "@opencode-ai/plugin";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPipelineTools } from "./tools.js";
import { createGuardHooks } from "./guard.js";

function scaffoldOnce(worktree: string) {
  const opencodeDir = path.join(worktree, ".opencode");
  const pkgDir = path.dirname(fileURLToPath(import.meta.url));
  const templatesDir = path.join(pkgDir, "..", "templates");

  if (!existsSync(templatesDir)) return;

  const agentsTarget = path.join(opencodeDir, "agents");
  const agentsSource = path.join(templatesDir, "agents");
  if (existsSync(agentsSource) && !existsSync(agentsTarget)) {
    mkdirSync(agentsTarget, { recursive: true });
    cpSync(agentsSource, agentsTarget, { recursive: true });
  }

  const commandsTarget = path.join(opencodeDir, "commands");
  const commandsSource = path.join(templatesDir, "commands");
  if (existsSync(commandsSource) && !existsSync(commandsTarget)) {
    mkdirSync(commandsTarget, { recursive: true });
    cpSync(commandsSource, commandsTarget, { recursive: true });
  }

  const binTarget = path.join(opencodeDir, "bin");
  const binSource = path.join(templatesDir, "bin");
  if (existsSync(binSource) && !existsSync(binTarget)) {
    mkdirSync(binTarget, { recursive: true });
    cpSync(binSource, binTarget, { recursive: true });
  }
}

export default {
  id: "oh-my-irving",
  server: (async ({ worktree }) => {
    scaffoldOnce(worktree);

    return {
      tool: createPipelineTools(worktree),
      ...createGuardHooks(worktree),
    };
  }) as Plugin,
};
