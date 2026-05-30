import { describe, it } from "node:test";
import assert from "node:assert";

// Replicate the functions under test since they are not exported from tools.ts
function parseYamlFrontmatter(content: string): { frontmatter: Record<string, unknown> | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  const frontmatterText = match[1];
  const body = match[2];

  const frontmatter: Record<string, unknown> = {};
  for (const line of frontmatterText.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        frontmatter[key] = JSON.parse(value);
      } catch {
        frontmatter[key] = value;
      }
    } else if (value === "true") {
      frontmatter[key] = true;
    } else if (value === "false") {
      frontmatter[key] = false;
    } else if (!isNaN(Number(value)) && value !== "") {
      frontmatter[key] = Number(value);
    } else {
      frontmatter[key] = value.replace(/^["'](.*)["']$/, "$1");
    }
  }

  return { frontmatter, body };
}

function validateWorkUnitFrontmatter(frontmatter: Record<string, unknown> | null): string | null {
  if (!frontmatter) return null;

  const requiredFields = ["id", "title", "status", "dependencies"];
  for (const field of requiredFields) {
    if (!(field in frontmatter)) {
      return `Missing required frontmatter field: ${field}`;
    }
  }

  if (!Array.isArray(frontmatter.dependencies)) {
    return "Field 'dependencies' must be an array";
  }

  return null;
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
