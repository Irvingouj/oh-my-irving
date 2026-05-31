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

  it("event hook registers child session only from explicit parentID", async () => {
    const input = { tool: "read", sessionID: "root-ses", callID: "call-root" };
    await hooks["tool.execute.before"](input, { args: { filePath: "/some/file.txt" } });

    await hooks.event({
      event: {
        type: "session.created",
        properties: {
          sessionID: "child-ses",
          info: { parentID: "root-ses" },
        },
      },
    });

    const anchor = JSON.parse(await readFile(sessionAnchorPath(tmpDir), "utf8"));
    assert.strictEqual(anchor.root_session_id, "root-ses");
    assert.deepStrictEqual(anchor.child_session_ids, ["child-ses"]);
  });

  it("tool.execute.before does not make a new top-level session a child of the old root", async () => {
    await hooks["tool.execute.before"](
      { tool: "read", sessionID: "old-root", callID: "call-old" },
      { args: { filePath: "/some/file.txt" } },
    );
    await hooks["tool.execute.before"](
      { tool: "read", sessionID: "new-root", callID: "call-new" },
      { args: { filePath: "/some/other-file.txt" } },
    );

    const anchor = JSON.parse(await readFile(sessionAnchorPath(tmpDir), "utf8"));
    assert.strictEqual(anchor.root_session_id, "old-root");
    assert.deepStrictEqual(anchor.child_session_ids, []);
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

  describe("anti-loop detection", () => {
    it("allows first call to any tool", async () => {
      const input = { tool: "irving_next", sessionID: "ses-1", callID: "call-1" };
      const output = { args: { action: "needs_human", why: "test" } };
      // Should not throw
      await hooks["tool.execute.before"](input, output);
    });

    it("blocks on 1st repeat with strike 1 message", async () => {
      const args = { action: "needs_human", why: "Waiting for input" };
      // Call 1: allowed
      await hooks["tool.execute.before"](
        { tool: "irving_next", sessionID: "ses-1", callID: "call-0" },
        { args },
      );
      // Call 2: strike 1
      await assert.rejects(
        async () => await hooks["tool.execute.before"](
          { tool: "irving_next", sessionID: "ses-1", callID: "call-1" },
          { args },
        ),
        /You are repeating yourself/,
      );
    });

    it("escalates to strike 2 on 2nd repeat", async () => {
      const args = { action: "needs_human", why: "Waiting for input" };
      // Call 1: allowed
      await hooks["tool.execute.before"](
        { tool: "irving_next", sessionID: "ses-1", callID: "call-0" },
        { args },
      );
      // Call 2: strike 1 (blocked but tracked)
      try { await hooks["tool.execute.before"]({ tool: "irving_next", sessionID: "ses-1", callID: "call-1" }, { args }); } catch {}
      // Call 3: strike 2
      await assert.rejects(
        async () => await hooks["tool.execute.before"](
          { tool: "irving_next", sessionID: "ses-1", callID: "call-2" },
          { args },
        ),
        /STILL repeating/,
      );
    });

    it("escalates to strike 3 on 3rd repeat", async () => {
      const args = { action: "needs_human", why: "Waiting for input" };
      await hooks["tool.execute.before"]({ tool: "irving_next", sessionID: "ses-1", callID: "call-0" }, { args });
      try { await hooks["tool.execute.before"]({ tool: "irving_next", sessionID: "ses-1", callID: "call-1" }, { args }); } catch {}
      try { await hooks["tool.execute.before"]({ tool: "irving_next", sessionID: "ses-1", callID: "call-2" }, { args }); } catch {}
      // Call 4: strike 3
      await assert.rejects(
        async () => await hooks["tool.execute.before"](
          { tool: "irving_next", sessionID: "ses-1", callID: "call-3" },
          { args },
        ),
        /THIRD WARNING/,
      );
    });

    it("allows same tool with different args", async () => {
      const input = (action: string) => ({
        tool: "irving_next",
        sessionID: "ses-1",
        callID: `call-${action}`,
      });
      // Different args each time — should all pass
      for (const action of ["continue", "needs_human", "continue", "blocked"]) {
        await hooks["tool.execute.before"](input(action), { args: { action, why: action } });
      }
    });

    it("blocks same tool with different args after 20 consecutive calls", async () => {
      for (let i = 0; i < 20; i++) {
        await hooks["tool.execute.before"](
          { tool: "irving_next", sessionID: "ses-1", callID: `call-${i}` },
          { args: { action: `action-${i}`, why: `reason-${i}` } },
        );
      }
      // 21st same-tool call should be blocked with graduated message
      await assert.rejects(
        async () => await hooks["tool.execute.before"](
          { tool: "irving_next", sessionID: "ses-1", callID: "call-21" },
          { args: { action: "yet-another", why: "still going" } },
        ),
        /\[anti-loop\]/,
      );
    });

    it("resets counter when a different tool is used", async () => {
      const args = { action: "needs_human", why: "waiting" };
      // 1 allowed call
      await hooks["tool.execute.before"](
        { tool: "irving_next", sessionID: "ses-1", callID: "call-0" },
        { args },
      );
      // Different tool resets the streak
      await hooks["tool.execute.before"](
        { tool: "irving_status", sessionID: "ses-1", callID: "call-break" },
        { args: {} },
      );
      // Now irving_next with same args should be allowed again (streak reset)
      await hooks["tool.execute.before"](
        { tool: "irving_next", sessionID: "ses-1", callID: "call-after" },
        { args },
      );
    });

    it("whitelisted tools are exempt from same-tool limit", async () => {
      // bash can be called 6 times with different args — no block
      for (let i = 0; i < 6; i++) {
        await hooks["tool.execute.before"](
          { tool: "bash", sessionID: "ses-1", callID: `call-${i}` },
          { args: { command: `echo ${i}` } },
        );
      }
    });

    it("whitelisted tools still blocked on identical args", async () => {
      const args = { command: "git status" };
      // Call 1: allowed
      await hooks["tool.execute.before"](
        { tool: "bash", sessionID: "ses-1", callID: "call-0" },
        { args },
      );
      // Call 2: strike 1 (identical args, even for whitelisted tools)
      await assert.rejects(
        async () => await hooks["tool.execute.before"](
          { tool: "bash", sessionID: "ses-1", callID: "call-1" },
          { args },
        ),
        /\[anti-loop\]/,
      );
    });

    describe("human reply gate", () => {
      it("blocks irving_next(accepted) without human reply", async () => {
        await assert.rejects(
          async () => await hooks["tool.execute.before"](
            { tool: "irving_next", sessionID: "ses-1", callID: "call-1" },
            { args: { action: "accepted", why: "done" } },
          ),
          /BLOCKED.*NO HUMAN REPLY/,
        );
      });

      it("allows irving_next(accepted) after human reply", async () => {
        // Simulate human reply via chat.message
        await hooks["chat.message"](
          { sessionID: "ses-1", agent: "orchestrator" },
          { message: { role: "user" }, parts: [{ type: "text", text: "approved" }] },
        );

        // Now accepted should be allowed
        await hooks["tool.execute.before"](
          { tool: "irving_next", sessionID: "ses-1", callID: "call-2" },
          { args: { action: "accepted", why: "done" } },
        );
      });

      it("blocks second accepted without another human reply", async () => {
        // First human reply + accepted
        await hooks["chat.message"](
          { sessionID: "ses-2", agent: "orchestrator" },
          { message: { role: "user" }, parts: [{ type: "text", text: "approved" }] },
        );
        await hooks["tool.execute.before"](
          { tool: "irving_next", sessionID: "ses-2", callID: "call-1" },
          { args: { action: "accepted", why: "done" } },
        );

        // Second accepted without new human reply → blocked
        await assert.rejects(
          async () => await hooks["tool.execute.before"](
            { tool: "irving_next", sessionID: "ses-2", callID: "call-2" },
            { args: { action: "accepted", why: "done again" } },
          ),
          /BLOCKED.*NO HUMAN REPLY/,
        );
      });

      it("allows irving_next(ready_for_final_review) after human reply", async () => {
        await hooks["chat.message"](
          { sessionID: "ses-3", agent: "orchestrator" },
          { message: { role: "user" }, parts: [{ type: "text", text: "go ahead" }] },
        );
        await hooks["tool.execute.before"](
          { tool: "irving_next", sessionID: "ses-3", callID: "call-1" },
          { args: { action: "ready_for_final_review", why: "all ACs met" } },
        );
      });

      it("allows irving_next(continue) without human reply", async () => {
        // continue is not a critical action — should always pass
        await hooks["tool.execute.before"](
          { tool: "irving_next", sessionID: "ses-4", callID: "call-1" },
          { args: { action: "continue", why: "keep going" } },
        );
      });

      it("allows irving_next(blocked) without human reply", async () => {
        // blocked is not a critical action — should always pass
        await hooks["tool.execute.before"](
          { tool: "irving_next", sessionID: "ses-4", callID: "call-2" },
          { args: { action: "blocked", why: "dependency issue" } },
        );
      });

      it("chat.message ignores non-user messages", async () => {
        // assistant message should not increment counter
        await hooks["chat.message"](
          { sessionID: "ses-5", agent: "orchestrator" },
          { message: { role: "assistant" }, parts: [{ type: "text", text: "thinking..." }] },
        );

        await assert.rejects(
          async () => await hooks["tool.execute.before"](
            { tool: "irving_next", sessionID: "ses-5", callID: "call-1" },
            { args: { action: "accepted", why: "done" } },
          ),
          /BLOCKED.*NO HUMAN REPLY/,
        );
      });

      it("auto-records human message to debate file", async () => {
        await mkdir(path.join(sessionDir(tmpDir, "ses-6"), "debate"), { recursive: true });
        await writeFile(
          path.join(sessionDir(tmpDir, "ses-6"), "state.json"),
          JSON.stringify({ version: 1, session_id: "ses-6", phase: "planning", planning: { status: "debating", round: 2 }, execution: { status: "not_started", iteration: 0, next_action: "continue", reason: "", blocking_question: null, last_error: null, active_work_units: [], blocked_work_units: [], ignored_findings: [], evidence: [] } }) + "\n",
          "utf8",
        );

        await hooks["chat.message"](
          { sessionID: "ses-6", agent: "orchestrator" },
          { message: { role: "user" }, parts: [{ type: "text", text: "I want it done by Friday" }] },
        );

        const file = path.join(sessionDir(tmpDir, "ses-6"), "debate", "round-002-human.md");
        assert.strictEqual(existsSync(file), true);
        const content = await readFile(file, "utf8");
        assert.ok(content.includes("I want it done by Friday"));
      });
    });
  });
});
