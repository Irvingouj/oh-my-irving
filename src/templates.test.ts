import { describe, it } from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.join(__dirname, "..", "templates");

async function readTemplate(...parts: string[]): Promise<string> {
  return await readFile(path.join(templatesDir, ...parts), "utf8");
}

describe("irving:debate command template", () => {
  it("mentions the 8-round limit", async () => {
    const content = await readTemplate("commands", "irving:debate.md");
    assert.ok(content.includes("Maximum 8 debate rounds"), "Should mention 8-round limit");
    assert.ok(content.includes("Hard limit"), "Should mention hard limit");
  });

  it("mentions convergence detection", async () => {
    const content = await readTemplate("commands", "irving:debate.md");
    assert.ok(content.includes("convergence detected"), "Should mention convergence detection");
    assert.ok(content.includes("substantially the same"), "Should mention substantial sameness check");
  });

  it("sets human_approval_pending when agreement reached", async () => {
    const content = await readTemplate("commands", "irving:debate.md");
    assert.ok(content.includes('status = "human_approval_pending"'), "Should set human_approval_pending status");
  });

  it("requires human explicit approval before execution", async () => {
    const content = await readTemplate("commands", "irving:debate.md");
    assert.ok(
      content.includes("human must explicitly approve the plan before execution can start"),
      "Should require explicit human approval"
    );
  });

  it("uses pipeline_set_planning_status to track rounds", async () => {
    const content = await readTemplate("commands", "irving:debate.md");
    assert.ok(
      content.includes("pipeline_set_planning_status"),
      "Should use pipeline_set_planning_status"
    );
  });
});

describe("irving:orchestrate command template", () => {
  it("checks plan approval before proceeding", async () => {
    const content = await readTemplate("commands", "irving:orchestrate.md");
    assert.ok(content.includes('planning.status is NOT "approved"'), "Should check planning.status");
    assert.ok(content.includes("Plan not approved. Run irving:debate first."), "Should mention debate first");
  });

  it("sets next_action to needs_human when plan not approved", async () => {
    const content = await readTemplate("commands", "irving:orchestrate.md");
    assert.ok(content.includes('next_action = "needs_human"'), "Should set needs_human");
  });
});

describe("irving:orchestrate-step command template", () => {
  it("checks plan approval before proceeding", async () => {
    const content = await readTemplate("commands", "irving:orchestrate-step.md");
    assert.ok(content.includes('planning.status is NOT "approved"'), "Should check planning.status");
    assert.ok(content.includes("Plan not approved. Run irving:debate first."), "Should mention debate first");
  });

  it("sets next_action to needs_human when plan not approved", async () => {
    const content = await readTemplate("commands", "irving:orchestrate-step.md");
    assert.ok(content.includes('next_action = "needs_human"'), "Should set needs_human");
  });
});

describe("orchestrator agent template", () => {
  it("mentions plan approval check in loop contract", async () => {
    const content = await readTemplate("agents", "orchestrator.md");
    assert.ok(
      content.includes('If phase is "planning" and plan is not approved, set next_action to "needs_human"'),
      "Should mention plan approval check in loop contract"
    );
  });

  it("mentions plan approval check in one iteration section", async () => {
    const content = await readTemplate("agents", "orchestrator.md");
    assert.ok(
      content.includes("Check plan approval status"),
      "Should mention checking plan approval status"
    );
    assert.ok(
      content.includes('planning.status is NOT "approved"'),
      "Should check planning.status in one iteration"
    );
  });
});
