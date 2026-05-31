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

function mockContext(sessionID: string, agent = "orchestrator"): ToolContext {
  return {
    sessionID,
    messageID: "msg-1",
    agent,
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

  describe("irving_session", () => {
    it("returns session info and creates dirs", async () => {
      const result = await tools.irving_session.execute({}, context);
      const parsed = JSON.parse(result as string);
      assert.strictEqual(parsed.session_id, "test-session");
      assert.ok(parsed.base_path.includes("test-session"));
      assert.strictEqual(existsSync(statePath(tmpDir, "test-session")), false);
    });
  });

  describe("irving_status", () => {
    it("returns state and null plan when no plan exists", async () => {
      const result = await tools.irving_status.execute({}, context);
      const parsed = JSON.parse(result as string);
      assert.strictEqual(parsed.state.version, 1);
      assert.strictEqual(parsed.state.phase, "init");
      assert.strictEqual(parsed.plan, null);
    });

    it("returns plan after one is created", async () => {
      await tools.irving_plan.execute({
        objective: "Test",
        criteria: "AC-1: Do something",
        units: "wu-1: First unit",
      }, context);

      const result = await tools.irving_status.execute({}, context);
      const parsed = JSON.parse(result as string);
      assert.ok(parsed.plan);
      assert.strictEqual(parsed.plan.objective, "Test");
    });
  });

  describe("irving_advance", () => {
    it("sets phase", async () => {
      const result = await tools.irving_advance.execute({ to: "planning" }, context);
      assert.strictEqual(result, "Phase set to planning");

      const file = statePath(tmpDir, "test-session");
      const state = JSON.parse(await readFile(file, "utf8"));
      assert.strictEqual(state.phase, "planning");
    });

    it("sets round via round:N syntax", async () => {
      const result = await tools.irving_advance.execute({ to: "round:3" }, context);
      assert.strictEqual(result, "Round set to 3");

      const file = statePath(tmpDir, "test-session");
      const state = JSON.parse(await readFile(file, "utf8"));
      assert.strictEqual(state.planning.round, 3);
      assert.strictEqual(state.planning.status, "debating");
    });

    it("rejects unknown phase", async () => {
      const result = await tools.irving_advance.execute({ to: "nonsense" }, context);
      assert.ok((result as string).includes("Unknown phase"));
    });
  });

  describe("irving_plan", () => {
    it("creates plan from simple strings", async () => {
      const result = await tools.irving_plan.execute({
        objective: "Build feature X",
        criteria: "AC-1: It works\nAC-2: It is tested",
        units: "wu-1: Implement X\nwu-2: Add tests (depends: wu-1)",
      }, context);
      assert.ok((result as string).includes("2 criteria"));
      assert.ok((result as string).includes("2 work units"));

      const file = planPath(tmpDir, "test-session");
      const plan = JSON.parse(await readFile(file, "utf8"));
      assert.strictEqual(plan.objective, "Build feature X");
      assert.strictEqual(plan.acceptance_criteria.length, 2);
      assert.strictEqual(plan.acceptance_criteria[0].id, "AC-1");
      assert.strictEqual(plan.acceptance_criteria[1].id, "AC-2");
      assert.strictEqual(plan.work_units.length, 2);
      assert.strictEqual(plan.work_units[0].id, "wu-1");
      assert.deepStrictEqual(plan.work_units[0].dependencies, []);
      assert.strictEqual(plan.work_units[1].id, "wu-2");
      assert.deepStrictEqual(plan.work_units[1].dependencies, ["wu-1"]);
    });

    it("auto-generates IDs when colon missing", async () => {
      await tools.irving_plan.execute({
        objective: "Test",
        criteria: "Just a description",
        units: "Just a unit",
      }, context);

      const file = planPath(tmpDir, "test-session");
      const plan = JSON.parse(await readFile(file, "utf8"));
      assert.strictEqual(plan.acceptance_criteria.length, 1);
      assert.ok(plan.acceptance_criteria[0].id);
      assert.strictEqual(plan.work_units.length, 1);
      assert.ok(plan.work_units[0].id);
    });
  });

  describe("irving_work_unit", () => {
    it("creates work unit file with YAML frontmatter", async () => {
      const result = await tools.irving_work_unit.execute({
        id: "wu-1",
        title: "Do the thing",
        body: "## Description\n\nDo it well.\n\n## Acceptance Criteria\n\n- [ ] Done",
      }, context);
      assert.strictEqual(result, "Created work unit wu-1");

      const file = path.join(sessionDir(tmpDir, "test-session"), "work-units", "wu-1.md");
      assert.strictEqual(existsSync(file), true);
      const content = await readFile(file, "utf8");
      assert.ok(content.includes("id: wu-1"));
      assert.ok(content.includes("title: \"Do the thing\""));
      assert.ok(content.includes("Do it well"));
    });
  });

  describe("irving_delegate", () => {
    it("sets active and blocked work units", async () => {
      const result = await tools.irving_delegate.execute({
        active: ["wu-1", "wu-2"],
        blocked: ["wu-3"],
      }, context);
      assert.ok((result as string).includes("wu-1, wu-2"));
      assert.ok((result as string).includes("wu-3"));

      const file = statePath(tmpDir, "test-session");
      const state = JSON.parse(await readFile(file, "utf8"));
      assert.deepStrictEqual(state.execution.active_work_units, ["wu-1", "wu-2"]);
      assert.deepStrictEqual(state.execution.blocked_work_units, ["wu-3"]);
    });
  });

  describe("irving_evidence", () => {
    it("records evidence without type arg", async () => {
      const result = await tools.irving_evidence.execute({
        ac_id: "AC-1",
        detail: "Tests pass for login flow",
      }, context);
      assert.strictEqual(result, "Evidence recorded for AC-1");

      const file = statePath(tmpDir, "test-session");
      const state = JSON.parse(await readFile(file, "utf8"));
      assert.strictEqual(state.execution.evidence.length, 1);
      assert.strictEqual(state.execution.evidence[0].ac_id, "AC-1");
      assert.strictEqual(state.execution.evidence[0].detail, "Tests pass for login flow");
    });
  });

  describe("irving_skip", () => {
    it("records skipped finding", async () => {
      const result = await tools.irving_skip.execute({
        finding_id: "F-1",
        why: "Pre-existing issue not touched by this work unit",
      }, context);
      assert.strictEqual(result, "Skipped finding F-1");

      const file = statePath(tmpDir, "test-session");
      const state = JSON.parse(await readFile(file, "utf8"));
      assert.strictEqual(state.execution.ignored_findings.length, 1);
      assert.strictEqual(state.execution.ignored_findings[0].finding_id, "F-1");
    });
  });

  describe("irving_note", () => {
    it("records a decision note", async () => {
      const result = await tools.irving_note.execute({
        kind: "decision",
        text: "Chose option B because of X",
      }, context);
      assert.strictEqual(result, "Recorded decision note");
    });

    it("records human context and appends to debate file", async () => {
      await tools.irving_advance.execute({ to: "round:1" }, context);
      const result = await tools.irving_note.execute({
        kind: "human_context",
        text: "User wants it done by Friday",
      }, context);
      assert.strictEqual(result, "Recorded human_context note");

      const file = path.join(sessionDir(tmpDir, "test-session"), "debate", "round-001-human.md");
      assert.strictEqual(existsSync(file), true);
      const content = await readFile(file, "utf8");
      assert.ok(content.includes("User wants it done by Friday"));
    });
  });

  describe("irving_next", () => {
    it("sets next action and reason", async () => {
      const result = await tools.irving_next.execute({
        action: "blocked",
        why: "Waiting for approval",
      }, context);
      assert.ok((result as string).includes("blocked"));

      const file = statePath(tmpDir, "test-session");
      const state = JSON.parse(await readFile(file, "utf8"));
      assert.strictEqual(state.execution.next_action, "blocked");
      assert.strictEqual(state.execution.reason, "Waiting for approval");
      assert.strictEqual(state.execution.blocking_question, "Waiting for approval");
    });

    it("defaults invalid action to blocked", async () => {
      const result = await tools.irving_next.execute({
        action: "bogus",
        why: "test",
      }, context);
      assert.ok((result as string).includes("blocked"));
    });

    it("sets continue without blocking question", async () => {
      await tools.irving_next.execute({
        action: "continue",
        why: "Keep going",
      }, context);

      const file = statePath(tmpDir, "test-session");
      const state = JSON.parse(await readFile(file, "utf8"));
      assert.strictEqual(state.execution.next_action, "continue");
      assert.strictEqual(state.execution.blocking_question, null);
    });
  });

  describe("orchestrator-only restriction", () => {
    let tmpDir: string;
    let tools: ReturnType<typeof createPipelineTools>;
    let agentContext: ToolContext;

    beforeEach(async () => {
      tmpDir = await mkdtemp(path.join(tmpdir(), "irving-tools-test-"));
      tools = createPipelineTools(tmpDir);
      agentContext = mockContext("test-session", "implementer");
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it("blocks irving_advance from non-orchestrator agent", async () => {
      await assert.rejects(
        async () => await tools.irving_advance.execute({ to: "planning" }, agentContext),
        /restricted to orchestrator/,
      );
    });

    it("blocks irving_next from non-orchestrator agent", async () => {
      await assert.rejects(
        async () => await tools.irving_next.execute({ action: "continue", why: "test" }, agentContext),
        /restricted to orchestrator/,
      );
    });

    it("allows irving_status from non-orchestrator agent", async () => {
      const result = await tools.irving_status.execute({}, agentContext);
      const parsed = JSON.parse(result as string);
      assert.strictEqual(parsed.state.version, 1);
    });

    it("allows irving_session from non-orchestrator agent", async () => {
      const result = await tools.irving_session.execute({}, agentContext);
      const parsed = JSON.parse(result as string);
      assert.ok(parsed.session_id);
    });
  });
});
