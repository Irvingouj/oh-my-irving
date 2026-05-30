import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readStateFile,
  writeStateFile,
  readPlanFile,
  writePlanFile,
  logEvent,
  type State,
  type Plan,
} from "./state.js";
import { sessionDir } from "./session.js";

describe("readStateFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "irving-state-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns default state when file does not exist", async () => {
    const state = await readStateFile(tmpDir, "ses-1");
    assert.strictEqual(state.version, 1);
    assert.strictEqual(state.session_id, "ses-1");
    assert.strictEqual(state.phase, "init");
    assert.strictEqual(state.planning.status, "not_started");
    assert.strictEqual(state.planning.round, 0);
    assert.strictEqual(state.execution.status, "not_started");
    assert.strictEqual(state.execution.iteration, 0);
    assert.strictEqual(state.execution.next_action, "continue");
    assert.strictEqual(state.execution.reason, "");
    assert.strictEqual(state.execution.blocking_question, null);
    assert.strictEqual(state.execution.last_error, null);
    assert.deepStrictEqual(state.execution.active_work_units, []);
    assert.deepStrictEqual(state.execution.blocked_work_units, []);
    assert.deepStrictEqual(state.execution.ignored_findings, []);
    assert.deepStrictEqual(state.execution.evidence, []);
  });

  it("reads existing state file", async () => {
    const sessionId = "ses-1";
    const state: State = {
      version: 1,
      session_id: sessionId,
      phase: "execution",
      planning: { status: "in_progress", round: 2 },
      execution: {
        status: "running",
        iteration: 3,
        next_action: "continue",
        reason: "test",
        blocking_question: null,
        last_error: null,
        active_work_units: ["wu-1"],
        blocked_work_units: [],
        ignored_findings: [],
        evidence: [],
      },
    };
    await writeStateFile(tmpDir, sessionId, state);
    const read = await readStateFile(tmpDir, sessionId);
    assert.deepStrictEqual(read, state);
  });
});

describe("writeStateFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "irving-state-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates state.json with correct content", async () => {
    const sessionId = "ses-1";
    const state: State = {
      version: 1,
      session_id: sessionId,
      phase: "planning",
      planning: { status: "done", round: 1 },
      execution: {
        status: "not_started",
        iteration: 0,
        next_action: "continue",
        reason: "",
        blocking_question: null,
        last_error: null,
        active_work_units: [],
        blocked_work_units: [],
        ignored_findings: [],
        evidence: [],
      },
    };
    await writeStateFile(tmpDir, sessionId, state);
    const filePath = path.join(sessionDir(tmpDir, sessionId), "state.json");
    assert.strictEqual(existsSync(filePath), true);
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    assert.deepStrictEqual(parsed, state);
  });
});

describe("readPlanFile and writePlanFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "irving-state-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("throws when plan.json does not exist", async () => {
    await assert.rejects(
      async () => await readPlanFile(tmpDir, "ses-1"),
      /plan\.json does not exist yet/,
    );
  });

  it("roundtrips plan data", async () => {
    const sessionId = "ses-1";
    const plan: Plan = {
      objective: "Test objective",
      acceptance_criteria: [
        { id: "ac-1", description: "First AC", status: "pending" },
      ],
      work_units: [
        { id: "wu-1", description: "First WU", status: "pending", dependencies: [] },
      ],
    };
    await writePlanFile(tmpDir, sessionId, plan);
    const read = await readPlanFile(tmpDir, sessionId);
    assert.deepStrictEqual(read, plan);
  });
});

describe("logEvent", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "irving-state-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("appends events to events.jsonl", async () => {
    const sessionId = "ses-1";
    await logEvent(tmpDir, sessionId, { type: "test.event", foo: "bar" });
    await logEvent(tmpDir, sessionId, { type: "test.event2", count: 42 });

    const logPath = path.join(sessionDir(tmpDir, sessionId), "logs", "events.jsonl");
    const content = await readFile(logPath, "utf8");
    const lines = content.trim().split("\n");
    assert.strictEqual(lines.length, 2);

    const event1 = JSON.parse(lines[0]);
    assert.strictEqual(event1.type, "test.event");
    assert.strictEqual(event1.foo, "bar");
    assert.ok(event1.timestamp);

    const event2 = JSON.parse(lines[1]);
    assert.strictEqual(event2.type, "test.event2");
    assert.strictEqual(event2.count, 42);
    assert.ok(event2.timestamp);
  });
});
