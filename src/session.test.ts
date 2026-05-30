import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolContext } from "@opencode-ai/plugin";
import {
  irvingBaseDir,
  sessionDir,
  sessionAnchorPath,
  statePath,
  planPath,
  contextPackPath,
  debateDir,
  reportsDir,
  reviewsDir,
  workUnitsDir,
  logsDir,
  ensureDirs,
  currentSessionId,
  assertSessionConsistent,
} from "./session.js";

describe("session path helpers", () => {
  const root = "/fake/root";
  const sessionId = "ses_123";

  it("irvingBaseDir returns correct path", () => {
    assert.strictEqual(irvingBaseDir(root), path.join(root, ".opencode", "irving"));
  });

  it("sessionDir returns correct path", () => {
    assert.strictEqual(sessionDir(root, sessionId), path.join(root, ".opencode", "irving", sessionId));
  });

  it("sessionAnchorPath returns correct path", () => {
    assert.strictEqual(sessionAnchorPath(root), path.join(root, ".opencode", "irving", ".active-session.json"));
  });

  it("statePath returns correct path", () => {
    assert.strictEqual(statePath(root, sessionId), path.join(root, ".opencode", "irving", sessionId, "state.json"));
  });

  it("planPath returns correct path", () => {
    assert.strictEqual(planPath(root, sessionId), path.join(root, ".opencode", "irving", sessionId, "plan.json"));
  });

  it("contextPackPath returns correct path", () => {
    assert.strictEqual(contextPackPath(root, sessionId), path.join(root, ".opencode", "irving", sessionId, "context-pack.md"));
  });

  it("debateDir returns correct path", () => {
    assert.strictEqual(debateDir(root, sessionId), path.join(root, ".opencode", "irving", sessionId, "debate"));
  });

  it("reportsDir returns correct path", () => {
    assert.strictEqual(reportsDir(root, sessionId), path.join(root, ".opencode", "irving", sessionId, "reports"));
  });

  it("reviewsDir returns correct path", () => {
    assert.strictEqual(reviewsDir(root, sessionId), path.join(root, ".opencode", "irving", sessionId, "reviews"));
  });

  it("workUnitsDir returns correct path", () => {
    assert.strictEqual(workUnitsDir(root, sessionId), path.join(root, ".opencode", "irving", sessionId, "work-units"));
  });

  it("logsDir returns correct path", () => {
    assert.strictEqual(logsDir(root, sessionId), path.join(root, ".opencode", "irving", sessionId, "logs"));
  });
});

describe("ensureDirs", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "irving-session-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates all session directories", async () => {
    const sessionId = "test-session";
    await ensureDirs(tmpDir, sessionId);

    assert.strictEqual(existsSync(sessionDir(tmpDir, sessionId)), true);
    assert.strictEqual(existsSync(debateDir(tmpDir, sessionId)), true);
    assert.strictEqual(existsSync(workUnitsDir(tmpDir, sessionId)), true);
    assert.strictEqual(existsSync(reportsDir(tmpDir, sessionId)), true);
    assert.strictEqual(existsSync(reviewsDir(tmpDir, sessionId)), true);
    assert.strictEqual(existsSync(logsDir(tmpDir, sessionId)), true);
  });
});

describe("currentSessionId", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "irving-session-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates anchor and returns context session id when no anchor exists", async () => {
    const context = { sessionID: "ctx-1" } as ToolContext;
    const result = await currentSessionId(tmpDir, context);
    assert.strictEqual(result, "ctx-1");
    assert.strictEqual(existsSync(sessionAnchorPath(tmpDir)), true);
  });

  it("returns requested session id when anchor exists and matches", async () => {
    const context = { sessionID: "ctx-1" } as ToolContext;
    await currentSessionId(tmpDir, context);

    const context2 = { sessionID: "ctx-2" } as ToolContext;
    const result = await currentSessionId(tmpDir, context2, "ctx-1");
    assert.strictEqual(result, "ctx-1");
  });

  it("throws when requested session id mismatches existing anchor", async () => {
    const context = { sessionID: "ctx-1" } as ToolContext;
    await currentSessionId(tmpDir, context);

    const context2 = { sessionID: "ctx-2" } as ToolContext;
    await assert.rejects(
      async () => await currentSessionId(tmpDir, context2, "ctx-3"),
      /Irving session mismatch/,
    );
  });

  it("throws when context has no sessionID", async () => {
    const context = {} as ToolContext;
    await assert.rejects(
      async () => await currentSessionId(tmpDir, context),
      /OpenCode TUI did not provide context.sessionID/,
    );
  });
});

describe("assertSessionConsistent", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "irving-session-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates anchor when none exists", async () => {
    await assertSessionConsistent(tmpDir, "ses-1");
    assert.strictEqual(existsSync(sessionAnchorPath(tmpDir)), true);
    const anchor = JSON.parse(await readFile(sessionAnchorPath(tmpDir), "utf8"));
    assert.strictEqual(anchor.root_session_id, "ses-1");
  });

  it("adds child session to existing anchor", async () => {
    await assertSessionConsistent(tmpDir, "root-ses");
    await assertSessionConsistent(tmpDir, "child-ses");
    const anchor = JSON.parse(await readFile(sessionAnchorPath(tmpDir), "utf8"));
    assert.strictEqual(anchor.root_session_id, "root-ses");
    assert.deepStrictEqual(anchor.child_session_ids, ["child-ses"]);
  });

  it("throws when sessionID is empty", async () => {
    await assert.rejects(
      async () => await assertSessionConsistent(tmpDir, ""),
      /OpenCode TUI did not provide sessionID/,
    );
  });
});
