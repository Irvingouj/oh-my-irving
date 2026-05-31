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

  it("asks for human approval when agreement reached", async () => {
    const content = await readTemplate("commands", "irving:debate.md");
    assert.ok(content.includes("Ask human for approval"), "Should ask human for approval");
  });

  it("requires human explicit approval before execution", async () => {
    const content = await readTemplate("commands", "irving:debate.md");
    assert.ok(
      content.includes("human must explicitly approve the plan before execution can start"),
      "Should require explicit human approval"
    );
  });

  it("uses irving_plan when human approves", async () => {
    const content = await readTemplate("commands", "irving:debate.md");
    assert.ok(
      content.includes("call irving_plan"),
      "Should use irving_plan"
    );
    assert.ok(
      content.includes('call irving_advance with "approved"'),
      "Should advance to approved"
    );
  });

  it("uses irving_advance to track rounds", async () => {
    const content = await readTemplate("commands", "irving:debate.md");
    assert.ok(
      content.includes("irving_advance"),
      "Should use irving_advance"
    );
  });
});

describe("irving:orchestrate command template", () => {
  it("checks plan approval before proceeding", async () => {
    const content = await readTemplate("commands", "irving:orchestrate.md");
    assert.ok(content.includes('planning.status is NOT "approved"'), "Should check planning.status");
    assert.ok(content.includes("Plan not approved. Run irving:debate first."), "Should mention debate first");
  });

  it("calls irving_next with blocked when plan not approved", async () => {
    const content = await readTemplate("commands", "irving:orchestrate.md");
    assert.ok(content.includes('"blocked"'), "Should set blocked");
  });
});

describe("irving:orchestrate-step command template", () => {
  it("checks plan approval before proceeding", async () => {
    const content = await readTemplate("commands", "irving:orchestrate-step.md");
    assert.ok(content.includes('planning.status is NOT "approved"'), "Should check planning.status");
    assert.ok(content.includes("Plan not approved. Run irving:debate first."), "Should mention debate first");
  });

  it("calls irving_next with blocked when plan not approved", async () => {
    const content = await readTemplate("commands", "irving:orchestrate-step.md");
    assert.ok(content.includes('"blocked"'), "Should set blocked");
  });
});

describe("orchestrator agent template", () => {
  it("mentions plan approval check in loop contract", async () => {
    const content = await readTemplate("agents", "orchestrator.md");
    assert.ok(
      content.includes("If phase is") && content.includes("blocked"),
      "Should mention plan approval check"
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

  it("mentions review-fixer for subsequent rounds", async () => {
    const content = await readTemplate("agents", "orchestrator.md");
    assert.ok(content.includes("review-fixer"), "Should mention review-fixer");
  });

  it("mentions 4-round max per work unit", async () => {
    const content = await readTemplate("agents", "orchestrator.md");
    assert.ok(content.includes("round < 4"), "Should enforce 4-round limit");
  });

  it("mentions pre-flight checks before final review", async () => {
    const content = await readTemplate("agents", "orchestrator.md");
    assert.ok(content.includes("Pre-flight Checks"), "Should have pre-flight checks section");
    assert.ok(content.includes("Build"), "Should mention build check");
    assert.ok(content.includes("Lint"), "Should mention lint check");
    assert.ok(content.includes("Tests"), "Should mention test check");
    assert.ok(content.includes("delegate back to the implementer"), "Should send failures back to implementer loop");
  });

  it("mentions pre-flight acceptance criteria in plan creation", async () => {
    const content = await readTemplate("agents", "orchestrator.md");
    assert.ok(content.includes("Pre-flight Acceptance Criteria"), "Should have pre-flight AC section");
    assert.ok(content.includes("builds without errors"), "Should mention build AC");
    assert.ok(content.includes("tests pass"), "Should mention test AC");
    assert.ok(content.includes("non-negotiable"), "Should mark these ACs as non-negotiable");
  });
});

describe("review-fixer agent template", () => {
  it("exists and has required structure", async () => {
    const content = await readTemplate("agents", "review-fixer.md");
    assert.ok(content.includes("Triage"), "Should mention triage step");
    assert.ok(content.includes("Fix"), "Should mention fix step");
    assert.ok(content.includes("report"), "Should mention report output");
  });

  it("requires finding validation against actual code", async () => {
    const content = await readTemplate("agents", "review-fixer.md");
    assert.ok(content.includes("Does the cited code actually exist"), "Should validate findings against code");
    assert.ok(content.includes("Does the claim hold up"), "Should validate claims");
  });

  it("writes fix report with round number", async () => {
    const content = await readTemplate("agents", "review-fixer.md");
    assert.ok(content.includes("fix-<ROUND>"), "Should write fix report with round number");
  });
});
