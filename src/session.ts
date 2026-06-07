import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ToolContext } from "@opencode-ai/plugin";

export type SessionAnchor = {
  version: 1;
  root_session_id: string;
  child_session_ids: string[];
  created_at: string;
  updated_at: string;
  session_id?: string;
};

export function irvingBaseDir(root: string) {
  return path.join(root, ".opencode", "irving");
}

export function sessionDir(root: string, sessionId: string) {
  return path.join(irvingBaseDir(root), sessionId);
}

export function sessionAnchorPath(root: string) {
  return path.join(irvingBaseDir(root), ".active-session.json");
}

export function statePath(root: string, sessionId: string) {
  return path.join(sessionDir(root, sessionId), "state.json");
}

export function planPath(root: string, sessionId: string) {
  return path.join(sessionDir(root, sessionId), "plan.json");
}

export function contextPackPath(root: string, sessionId: string) {
  return path.join(sessionDir(root, sessionId), "context-pack.md");
}

export function debateDir(root: string, sessionId: string) {
  return path.join(sessionDir(root, sessionId), "debate");
}

export function reportsDir(root: string, sessionId: string) {
  return path.join(sessionDir(root, sessionId), "reports");
}

export function reviewsDir(root: string, sessionId: string) {
  return path.join(sessionDir(root, sessionId), "reviews");
}

export function workUnitsDir(root: string, sessionId: string) {
  return path.join(sessionDir(root, sessionId), "work-units");
}

export function logsDir(root: string, sessionId: string) {
  return path.join(sessionDir(root, sessionId), "logs");
}

export async function ensureDirs(root: string, sessionId: string) {
  const base = sessionDir(root, sessionId);
  for (const dir of [
    base,
    debateDir(root, sessionId),
    workUnitsDir(root, sessionId),
    reportsDir(root, sessionId),
    reviewsDir(root, sessionId),
    logsDir(root, sessionId),
  ]) {
    await mkdir(dir, { recursive: true });
  }
}

export async function currentSessionId(
  root: string,
  context: ToolContext,
  requestedSessionId?: string | null,
): Promise<string> {
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

  // If context session is the root → continuing same conversation
  if (contextSessionId === rootSessionId) {
    await writeFile(
      file,
      JSON.stringify({ ...anchor, updated_at: now }, null, 2) + "\n",
      "utf8",
    );
    return rootSessionId;
  }

  // If context session is a known child → subagent call
  const childSessionIds = anchor.child_session_ids ?? [];
  if (childSessionIds.includes(contextSessionId)) {
    return rootSessionId;
  }

  // context session is neither root nor child

  // If an explicit requestedSessionId matches the root → subagent that knows its parent
  if (requestedSessionId && requestedSessionId === rootSessionId) {
    childSessionIds.push(contextSessionId);
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

  // Explicit mismatch → error
  if (requestedSessionId && requestedSessionId !== rootSessionId) {
    throw new Error(
      `Irving session mismatch. Expected root session ${rootSessionId}, got requested session ${requestedSessionId}.`,
    );
  }

  // No requestedSessionId, not root, not child → new conversation
  const newAnchor: SessionAnchor = {
    version: 1,
    root_session_id: contextSessionId,
    child_session_ids: [],
    created_at: now,
    updated_at: now,
  };
  await writeFile(file, JSON.stringify(newAnchor, null, 2) + "\n", "utf8");
  return contextSessionId;
}

export async function assertSessionConsistent(worktree: string, sessionID: string) {
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

  const anchor = JSON.parse(await readFile(file, "utf8")) as SessionAnchor;
  const rootSessionId = anchor.root_session_id || anchor.session_id;
  if (!rootSessionId) {
    throw new Error(`Invalid Irving session anchor at ${file}: missing root_session_id.`);
  }
  const childSessionIds = anchor.child_session_ids ?? [];

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

export async function registerChildSession(
  worktree: string,
  parentSessionID: string,
  childSessionID: string,
) {
  if (!parentSessionID || !childSessionID || parentSessionID === childSessionID) return false;

  const file = sessionAnchorPath(worktree);
  if (!existsSync(file)) return false;

  const anchor = JSON.parse(await readFile(file, "utf8")) as SessionAnchor;
  const rootSessionId = anchor.root_session_id || anchor.session_id;
  if (!rootSessionId) {
    throw new Error(`Invalid Irving session anchor at ${file}: missing root_session_id.`);
  }

  const childSessionIds = anchor.child_session_ids ?? [];
  const parentBelongsToRoot = parentSessionID === rootSessionId || childSessionIds.includes(parentSessionID);
  if (!parentBelongsToRoot) return false;
  if (childSessionIds.includes(childSessionID)) return true;

  const now = new Date().toISOString();
  childSessionIds.push(childSessionID);
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
  return true;
}
