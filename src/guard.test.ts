import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGuardHooks } from "./guard.js";
import { sessionDir, sessionAnchorPath } from "./session.js";

describe("createGuardHooks", () => {
  let tmpDir: string;
  let hooks: ReturnType<typeof createGuardHooks>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "irving-guard-test-"));
    hooks = createGuardHooks(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("tool.execute.before logs to session events.jsonl", async () => {
    const input = { tool: "read", sessionID: "ses-1", callID: "call-1" };
    const output = { args: { filePath: "/some/file.txt" } };
    await hooks["tool.execute.before"](input, output);

    const logPath = path.join(sessionDir(tmpDir, "ses-1"), "logs", "events.jsonl");
    assert.strictEqual(existsSync(logPath), true);
    const content = await readFile(logPath, "utf8");
    const lines = content.trim().split("\n");
    assert.strictEqual(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.strictEqual(event.type, "tool.before");
    assert.strictEqual(event.tool, "read");
    assert.strictEqual(event.session_id, "ses-1");
    assert.ok(event.timestamp);
  });

  it("tool.execute.after logs to session events.jsonl", async () => {
    const input = { tool: "read", sessionID: "ses-1", callID: "call-1", args: {} };
    const output = { title: "Read", output: "content", metadata: {} };
    await hooks["tool.execute.after"](input, output);

    const logPath = path.join(sessionDir(tmpDir, "ses-1"), "logs", "events.jsonl");
    const content = await readFile(logPath, "utf8");
    const lines = content.trim().split("\n");
    assert.strictEqual(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.strictEqual(event.type, "tool.after");
    assert.strictEqual(event.tool, "read");
    assert.ok(event.timestamp);
  });

  it("event hook logs to session events.jsonl when session_id is in event", async () => {
    const input = { event: { type: "session.created", session_id: "ses-1" } };
    await hooks.event(input);

    const logPath = path.join(sessionDir(tmpDir, "ses-1"), "logs", "events.jsonl");
    assert.strictEqual(existsSync(logPath), true);
    const content = await readFile(logPath, "utf8");
    const lines = content.trim().split("\n");
    assert.strictEqual(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.strictEqual(event.type, "session.created");
    assert.ok(event.timestamp);
  });

  it("event hook falls back to anchor root_session_id when no session_id in event", async () => {
    const anchorDir = path.join(tmpDir, ".opencode", "irving");
    await mkdir(anchorDir, { recursive: true });
    await writeFile(
      sessionAnchorPath(tmpDir),
      JSON.stringify({
        version: 1,
        root_session_id: "root-ses",
        child_session_ids: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }) + "\n",
      "utf8",
    );

    const input = { event: { type: "session.status", status: "idle" } };
    await hooks.event(input);

    const logPath = path.join(sessionDir(tmpDir, "root-ses"), "logs", "events.jsonl");
    assert.strictEqual(existsSync(logPath), true);
    const content = await readFile(logPath, "utf8");
    const lines = content.trim().split("\n");
    assert.strictEqual(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.strictEqual(event.type, "session.status");
    assert.ok(event.timestamp);
  });

  it("event hook skips logging when no session_id and no anchor", async () => {
    const input = { event: { type: "session.status", status: "idle" } };
    await hooks.event(input);

    // No logs should be created
    const baseDir = path.join(tmpDir, ".opencode", "irving");
    assert.strictEqual(existsSync(baseDir), false);
  });

  it("shell.env sets OPENCODE_SESSION_ID when sessionID is present", async () => {
    const input = { cwd: "/tmp", sessionID: "ses-1", callID: "call-1" };
    const output = { env: {} as Record<string, string> };
    await hooks["shell.env"](input, output);
    assert.strictEqual(output.env.OPENCODE_SESSION_ID, "ses-1");
  });

  it("shell.env does not set OPENCODE_SESSION_ID when sessionID is absent", async () => {
    const input = { cwd: "/tmp" };
    const output = { env: {} as Record<string, string> };
    await hooks["shell.env"](input, output);
    assert.strictEqual(output.env.OPENCODE_SESSION_ID, undefined);
  });

  it("tool.execute.before throws for protected files", async () => {
    const input = { tool: "edit", sessionID: "ses-1", callID: "call-1" };
    const output = { args: { filePath: ".opencode/irving/ses-1/state.json" } };
    await assert.rejects(
      async () => await hooks["tool.execute.before"](input, output),
      /Modify state\.json through pipeline_\* tools only\./,
    );
  });
});
