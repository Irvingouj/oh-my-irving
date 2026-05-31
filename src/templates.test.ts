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

  it("calls irving_next with needs_human when plan not approved", async () => {
    const content = await readTemplate("commands", "irving:orchestrate.md");
    assert.ok(content.includes('"needs_human"'), "Should set needs_human");
  });
});

describe("irving:orchestrate-step command template", () => {
  it("checks plan approval before proceeding", async () => {
    const content = await readTemplate("commands", "irving:orchestrate-step.md");
    assert.ok(content.includes('planning.status is NOT "approved"'), "Should check planning.status");
    assert.ok(content.includes("Plan not approved. Run irving:debate first."), "Should mention debate first");
  });

  it("calls irving_next with needs_human when plan not approved", async () => {
    const content = await readTemplate("commands", "irving:orchestrate-step.md");
    assert.ok(content.includes('"needs_human"'), "Should set needs_human");
  });
});

describe("orchestrator agent template", () => {
  it("mentions plan approval check in loop contract", async () => {
    const content = await readTemplate("agents", "orchestrator.md");
    assert.ok(
      content.includes("If phase is") && content.includes("needs_human"),
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
});
