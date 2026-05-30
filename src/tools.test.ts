import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolContext } from "@opencode-ai/plugin";
import {
  parseYamlFrontmatter,
  validateWorkUnitFrontmatter,
  createPipelineTools,
} from "./tools.js";
import { sessionDir, statePath, planPath } from "./session.js";

function mockContext(sessionID: string): ToolContext {
  return {
    sessionID,
    messageID: "msg-1",
    agent: "test-agent",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  };
}

describe("parseYamlFrontmatter", () => {
  it("returns null frontmatter for plain markdown", () => {
    const content = "# Hello\n\nSome text.";
    const result = parseYamlFrontmatter(content);
    assert.strictEqual(result.frontmatter, null);
    assert.strictEqual(result.body, content);
  });

  it("parses simple key-value pairs", () => {
    const content = "---\nid: wu-1\ntitle: Test\nstatus: pending\n---\n\n# Body";
    const result = parseYamlFrontmatter(content);
    assert.notStrictEqual(result.frontmatter, null);
    assert.strictEqual(result.frontmatter!.id, "wu-1");
    assert.strictEqual(result.frontmatter!.title, "Test");
    assert.strictEqual(result.frontmatter!.status, "pending");
    assert.strictEqual(result.body, "\n# Body");
  });

  it("parses arrays", () => {
    const content = "---\ndependencies: [\"wu-1\", \"wu-2\"]\n---\n\nBody";
    const result = parseYamlFrontmatter(content);
    assert.deepStrictEqual(result.frontmatter!.dependencies, ["wu-1", "wu-2"]);
  });

  it("parses booleans and numbers", () => {
    const content = "---\nactive: true\ncount: 42\n---\n\nBody";
    const result = parseYamlFrontmatter(content);
    assert.strictEqual(result.frontmatter!.active, true);
    assert.strictEqual(result.frontmatter!.count, 42);
  });

  it("strips quotes from string values", () => {
    const content = '---\ntitle: "Quoted Title"\n---\n\nBody';
    const result = parseYamlFrontmatter(content);
    assert.strictEqual(result.frontmatter!.title, "Quoted Title");
  });
});

describe("validateWorkUnitFrontmatter", () => {
  it("returns null when frontmatter is missing (backward compatible)", () => {
    const result = validateWorkUnitFrontmatter(null);
    assert.strictEqual(result, null);
  });

  it("returns null for valid frontmatter with all required fields", () => {
    const frontmatter = {
      id: "wu-1",
      title: "Test",
      status: "pending",
      dependencies: [],
    };
    const result = validateWorkUnitFrontmatter(frontmatter);
    assert.strictEqual(result, null);
  });

  it("returns error when id is missing", () => {
    const frontmatter = {
      title: "Test",
      status: "pending",
      dependencies: [],
    };
    const result = validateWorkUnitFrontmatter(frontmatter);
    assert.strictEqual(result, "Missing required frontmatter field: id");
  });

  it("returns error when title is missing", () => {
    const frontmatter = {
      id: "wu-1",
      status: "pending",
      dependencies: [],
    };
    const result = validateWorkUnitFrontmatter(frontmatter);
    assert.strictEqual(result, "Missing required frontmatter field: title");
  });

  it("returns error when status is missing", () => {
    const frontmatter = {
      id: "wu-1",
      title: "Test",
      dependencies: [],
    };
    const result = validateWorkUnitFrontmatter(frontmatter);
    assert.strictEqual(result, "Missing required frontmatter field: status");
  });

  it("returns error when dependencies is missing", () => {
    const frontmatter = {
      id: "wu-1",
      title: "Test",
      status: "pending",
    };
    const result = validateWorkUnitFrontmatter(frontmatter);
    assert.strictEqual(result, "Missing required frontmatter field: dependencies");
  });

  it("returns error when dependencies is not an array", () => {
    const frontmatter = {
      id: "wu-1",
      title: "Test",
      status: "pending",
      dependencies: "wu-2",
    };
    const result = validateWorkUnitFrontmatter(frontmatter);
    assert.strictEqual(result, "Field 'dependencies' must be an array");
  });
});

describe("pipeline tools", () => {
  let tmpDir: string;
  let tools: ReturnType<typeof createPipelineTools>;
  let context: ToolContext;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "irving-tools-test-"));
    tools = createPipelineTools(tmpDir);
    context = mockContext("test-session");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("pipeline_init", () => {
    it("creates state.json with correct structure", async () => {
      const result = await tools.pipeline_init.execute({}, context);
      const resultStr = result as string;
      assert.ok(resultStr.includes("test-session"));
      assert.ok(resultStr.includes(".opencode/irving/test-session/"));

      const file = statePath(tmpDir, "test-session");
      assert.strictEqual(existsSync(file), true);

      const content = await readFile(file, "utf8");
      const state = JSON.parse(content);
      assert.strictEqual(state.version, 1);
      assert.strictEqual(state.session_id, "test-session");
      assert.strictEqual(state.phase, "init");
      assert.strictEqual(state.planning.status, "not_started");
      assert.strictEqual(state.planning.round, 0);
      assert.strictEqual(state.execution.status, "not_started");
      assert.strictEqual(state.execution.iteration, 0);
      assert.strictEqual(state.execution.next_action, "continue");
      assert.deepStrictEqual(state.execution.active_work_units, []);
      assert.deepStrictEqual(state.execution.blocked_work_units, []);
      assert.deepStrictEqual(state.execution.ignored_findings, []);
      assert.deepStrictEqual(state.execution.evidence, []);
    });

    it("creates event log entry", async () => {
      await tools.pipeline_init.execute({}, context);
      const logPath = path.join(sessionDir(tmpDir, "test-session"), "logs", "events.jsonl");
      assert.strictEqual(existsSync(logPath), true);
      const content = await readFile(logPath, "utf8");
      const lines = content.trim().split("\n");
      assert.strictEqual(lines.length, 1);
      const event = JSON.parse(lines[0]);
      assert.strictEqual(event.type, "pipeline.init");
      assert.ok(event.timestamp);
    });
  });

  describe("pipeline_read_state", () => {
    it("reads default state when file does not exist", async () => {
      const result = await tools.pipeline_read_state.execute({ session_id: null }, context);
      const state = JSON.parse(result as string);
      assert.strictEqual(state.version, 1);
      assert.strictEqual(state.session_id, "test-session");
      assert.strictEqual(state.phase, "init");
    });

    it("reads existing state file", async () => {
      await tools.pipeline_init.execute({}, context);
      await tools.pipeline_set_phase.execute({ session_id: null, phase: "execution" }, context);

      const result = await tools.pipeline_read_state.execute({ session_id: null }, context);
      const state = JSON.parse(result as string);
      assert.strictEqual(state.phase, "execution");
    });
  });

  describe("pipeline_set_phase", () => {
    it("updates phase correctly", async () => {
      await tools.pipeline_init.execute({}, context);
      const result = await tools.pipeline_set_phase.execute({ session_id: null, phase: "planning" }, context);
      assert.strictEqual(result, "Phase set to planning");

      const file = statePath(tmpDir, "test-session");
      const content = await readFile(file, "utf8");
      const state = JSON.parse(content);
      assert.strictEqual(state.phase, "planning");
    });

    it("logs phase change event", async () => {
      await tools.pipeline_init.execute({}, context);
      await tools.pipeline_set_phase.execute({ session_id: null, phase: "discovery" }, context);

      const logPath = path.join(sessionDir(tmpDir, "test-session"), "logs", "events.jsonl");
      const content = await readFile(logPath, "utf8");
      const lines = content.trim().split("\n");
      assert.ok(lines.length >= 2);
      const event = JSON.parse(lines[lines.length - 1]);
      assert.strictEqual(event.type, "pipeline.phase");
      assert.strictEqual(event.phase, "discovery");
    });
  });

  describe("pipeline_create_plan", () => {
    it("creates plan.json with validation", async () => {
      const plan = {
        objective: "Test objective",
        acceptance_criteria: [
          { id: "ac-1", description: "First AC", status: "pending" },
        ],
        work_units: [
          { id: "wu-1", description: "First WU", status: "pending", dependencies: [] },
        ],
      };

      const result = await tools.pipeline_create_plan.execute(
        { session_id: null, plan: JSON.stringify(plan) },
        context,
      );
      const resultStr = result as string;
      assert.ok(resultStr.includes("plan.json"));

      const file = planPath(tmpDir, "test-session");
      assert.strictEqual(existsSync(file), true);

      const content = await readFile(file, "utf8");
      const saved = JSON.parse(content);
      assert.strictEqual(saved.objective, "Test objective");
      assert.deepStrictEqual(saved.acceptance_criteria, plan.acceptance_criteria);
      assert.deepStrictEqual(saved.work_units, plan.work_units);
    });

    it("throws for invalid plan", async () => {
      const badPlan = { objective: "Test" }; // missing acceptance_criteria and work_units
      await assert.rejects(
        async () =>
          await tools.pipeline_create_plan.execute(
            { session_id: null, plan: JSON.stringify(badPlan) },
            context,
          ),
        /Invalid plan/,
      );
    });
  });

  describe("pipeline_record_evidence", () => {
    it("appends evidence correctly", async () => {
      await tools.pipeline_init.execute({}, context);
      const result = await tools.pipeline_record_evidence.execute(
        { session_id: null, ac_id: "ac-1", type: "test", detail: "Tests pass" },
        context,
      );
      assert.strictEqual(result, "Recorded evidence for ac-1");

      const file = statePath(tmpDir, "test-session");
      const content = await readFile(file, "utf8");
      const state = JSON.parse(content);
      assert.strictEqual(state.execution.evidence.length, 1);
      assert.strictEqual(state.execution.evidence[0].ac_id, "ac-1");
      assert.strictEqual(state.execution.evidence[0].type, "test");
      assert.strictEqual(state.execution.evidence[0].detail, "Tests pass");
    });

    it("logs evidence event", async () => {
      await tools.pipeline_init.execute({}, context);
      await tools.pipeline_record_evidence.execute(
        { session_id: null, ac_id: "ac-2", type: "manual", detail: "Verified" },
        context,
      );

      const logPath = path.join(sessionDir(tmpDir, "test-session"), "logs", "events.jsonl");
      const content = await readFile(logPath, "utf8");
      const lines = content.trim().split("\n");
      const event = JSON.parse(lines[lines.length - 1]);
      assert.strictEqual(event.type, "pipeline.evidence");
      assert.strictEqual(event.ac_id, "ac-2");
      assert.strictEqual(event.evidence_type, "manual");
    });
  });

  describe("pipeline_set_next_action", () => {
    it("sets next action and reason", async () => {
      await tools.pipeline_init.execute({}, context);
      const result = await tools.pipeline_set_next_action.execute(
        { session_id: null, next_action: "needs_human", reason: "Waiting for approval" },
        context,
      );

      const parsed = JSON.parse(result as string);
      assert.strictEqual(parsed.next_action, "needs_human");
      assert.strictEqual(parsed.reason, "Waiting for approval");
      assert.strictEqual(parsed.blocking_question, null);
      assert.strictEqual(parsed.iteration, 0);

      const file = statePath(tmpDir, "test-session");
      const content = await readFile(file, "utf8");
      const state = JSON.parse(content);
      assert.strictEqual(state.execution.next_action, "needs_human");
      assert.strictEqual(state.execution.reason, "Waiting for approval");
      assert.strictEqual(state.execution.blocking_question, null);
    });

    it("sets blocking question when provided", async () => {
      await tools.pipeline_init.execute({}, context);
      await tools.pipeline_set_next_action.execute(
        {
          session_id: null,
          next_action: "needs_human",
          reason: "Need clarification",
          blocking_question: "What should I do next?",
        },
        context,
      );

      const file = statePath(tmpDir, "test-session");
      const content = await readFile(file, "utf8");
      const state = JSON.parse(content);
      assert.strictEqual(state.execution.blocking_question, "What should I do next?");
    });

    it("logs next_action event", async () => {
      await tools.pipeline_init.execute({}, context);
      await tools.pipeline_set_next_action.execute(
        { session_id: null, next_action: "continue", reason: "Keep going" },
        context,
      );

      const logPath = path.join(sessionDir(tmpDir, "test-session"), "logs", "events.jsonl");
      const content = await readFile(logPath, "utf8");
      const lines = content.trim().split("\n");
      const event = JSON.parse(lines[lines.length - 1]);
      assert.strictEqual(event.type, "pipeline.next_action");
      assert.strictEqual(event.next_action, "continue");
      assert.strictEqual(event.reason, "Keep going");
    });
  });
});
