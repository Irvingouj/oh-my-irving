import { describe, it } from "node:test";
import assert from "node:assert";
import { validateState, validatePlan, validateWorkUnit } from "./schema.js";
import type { State, Plan } from "./state.js";

function makeValidState(): State {
  return {
    version: 1,
    session_id: "ses-1",
    phase: "init",
    planning: { status: "not_started", round: 0 },
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
      findings: [],
    },
  };
}

function makeValidPlan(): Plan {
  return {
    objective: "Test objective",
    acceptance_criteria: [
      { id: "ac-1", description: "First AC", status: "pending" },
    ],
    work_units: [
      { id: "wu-1", description: "First WU", status: "pending", dependencies: [] },
    ],
  };
}

describe("validateState", () => {
  it("passes for a valid state", () => {
    const state = makeValidState();
    const result = validateState(state);
    assert.deepStrictEqual(result, state);
  });

  it("throws when state is not an object", () => {
    assert.throws(() => validateState(null), /Invalid state: expected object/);
    assert.throws(() => validateState("string"), /Invalid state: expected object/);
    assert.throws(() => validateState(42), /Invalid state: expected object/);
  });

  it("throws when version is not 1", () => {
    const state = { ...makeValidState(), version: 2 };
    assert.throws(() => validateState(state), /Invalid state.version: must be 1/);
  });

  it("throws when session_id is not a string", () => {
    const state = { ...makeValidState(), session_id: 123 };
    assert.throws(() => validateState(state), /Invalid state.session_id: expected string/);
  });

  it("throws when phase is invalid", () => {
    const state = { ...makeValidState(), phase: "invalid_phase" };
    assert.throws(
      () => validateState(state),
      /Invalid state.phase: must be one of init, discovery, planning, execution, final_review, accepted, blocked/,
    );
  });

  it("throws when planning is missing", () => {
    const state = { ...makeValidState(), planning: undefined };
    assert.throws(() => validateState(state), /Invalid state.planning: expected object/);
  });

  it("throws when planning.status is not a string", () => {
    const state = { ...makeValidState(), planning: { status: 123, round: 0 } };
    assert.throws(() => validateState(state), /Invalid state.planning.status: expected string/);
  });

  it("throws when planning.round is not a number", () => {
    const state = { ...makeValidState(), planning: { status: "ok", round: "zero" } };
    assert.throws(() => validateState(state), /Invalid state.planning.round: expected number/);
  });

  it("throws when execution is missing", () => {
    const state = { ...makeValidState(), execution: undefined };
    assert.throws(() => validateState(state), /Invalid state.execution: expected object/);
  });

  it("throws when execution.status is not a string", () => {
    const state = { ...makeValidState(), execution: { ...makeValidState().execution, status: 123 } };
    assert.throws(() => validateState(state), /Invalid state.execution.status: expected string/);
  });

  it("throws when execution.iteration is not a number", () => {
    const state = { ...makeValidState(), execution: { ...makeValidState().execution, iteration: "one" } };
    assert.throws(() => validateState(state), /Invalid state.execution.iteration: expected number/);
  });

  it("throws when execution.next_action is invalid", () => {
    const state = { ...makeValidState(), execution: { ...makeValidState().execution, next_action: "pause" } };
    assert.throws(
      () => validateState(state),
      /Invalid state.execution.next_action: must be one of continue, ready_for_final_review, accepted, blocked, failed/,
    );
  });

  it("throws when active_work_units is not an array of strings", () => {
    const state = { ...makeValidState(), execution: { ...makeValidState().execution, active_work_units: [1, 2] } };
    assert.throws(() => validateState(state), /Invalid state.execution.active_work_units\[0\]: expected string/);
  });

  it("throws when blocked_work_units is not an array of strings", () => {
    const state = { ...makeValidState(), execution: { ...makeValidState().execution, blocked_work_units: [true] } };
    assert.throws(() => validateState(state), /Invalid state.execution.blocked_work_units\[0\]: expected string/);
  });

  it("accepts all valid phases", () => {
    const phases = ["init", "discovery", "planning", "execution", "final_review", "accepted", "blocked"] as const;
    for (const phase of phases) {
      const state = { ...makeValidState(), phase };
      assert.doesNotThrow(() => validateState(state));
    }
  });

  it("accepts all valid next_actions", () => {
    const actions = ["continue", "ready_for_final_review", "accepted", "blocked", "failed"] as const;
    for (const next_action of actions) {
      const state = { ...makeValidState(), execution: { ...makeValidState().execution, next_action } };
      assert.doesNotThrow(() => validateState(state));
    }
  });

  it("fills in optional fields with defaults when missing", () => {
    const state = {
      version: 1,
      session_id: "ses-1",
      phase: "init",
      planning: { status: "not_started", round: 0 },
      execution: {
        status: "not_started",
        iteration: 0,
        next_action: "continue",
        active_work_units: [],
        blocked_work_units: [],
      },
    };
    const result = validateState(state);
    assert.strictEqual(result.execution.reason, "");
    assert.strictEqual(result.execution.blocking_question, null);
    assert.strictEqual(result.execution.last_error, null);
    assert.deepStrictEqual(result.execution.ignored_findings, []);
    assert.deepStrictEqual(result.execution.evidence, []);
  });

  it("validates ignored_findings when present", () => {
    const state = {
      ...makeValidState(),
      execution: {
        ...makeValidState().execution,
        ignored_findings: [{ finding_id: "f-1", reason: "ok" }],
      },
    };
    assert.doesNotThrow(() => validateState(state));
  });

  it("throws when ignored_findings entry is invalid", () => {
    const state = {
      ...makeValidState(),
      execution: {
        ...makeValidState().execution,
        ignored_findings: [{ finding_id: 123, reason: "ok" }],
      },
    };
    assert.throws(
      () => validateState(state),
      /Invalid state.execution.ignored_findings\[0\].finding_id: expected string/,
    );
  });

  it("validates evidence when present", () => {
    const state = {
      ...makeValidState(),
      execution: {
        ...makeValidState().execution,
        evidence: [{ ac_id: "ac-1", type: "test", detail: "passes" }],
      },
    };
    assert.doesNotThrow(() => validateState(state));
  });

  it("throws when evidence type is invalid", () => {
    const state = {
      ...makeValidState(),
      execution: {
        ...makeValidState().execution,
        evidence: [{ ac_id: "ac-1", type: "invalid", detail: "passes" }],
      },
    };
    assert.throws(
      () => validateState(state),
      /Invalid state.execution.evidence\[0\].type: must be one of test, review, manual, static/,
    );
  });
});

describe("validatePlan", () => {
  it("passes for a valid plan", () => {
    const plan = makeValidPlan();
    const result = validatePlan(plan);
    assert.deepStrictEqual(result, plan);
  });

  it("throws when plan is not an object", () => {
    assert.throws(() => validatePlan(null), /Invalid plan: expected object/);
    assert.throws(() => validatePlan("string"), /Invalid plan: expected object/);
  });

  it("throws when objective is not a string", () => {
    const plan = { ...makeValidPlan(), objective: 123 };
    assert.throws(() => validatePlan(plan), /Invalid plan.objective: expected string/);
  });

  it("throws when acceptance_criteria is not an array", () => {
    const plan = { ...makeValidPlan(), acceptance_criteria: "none" };
    assert.throws(() => validatePlan(plan), /Invalid plan.acceptance_criteria: expected array/);
  });

  it("throws when acceptance_criteria entry is missing id", () => {
    const plan = {
      ...makeValidPlan(),
      acceptance_criteria: [{ description: "desc", status: "pending" }],
    };
    assert.throws(() => validatePlan(plan), /Invalid plan.acceptance_criteria\[0\].id: expected string/);
  });

  it("throws when acceptance_criteria entry is missing description", () => {
    const plan = {
      ...makeValidPlan(),
      acceptance_criteria: [{ id: "ac-1", status: "pending" }],
    };
    assert.throws(() => validatePlan(plan), /Invalid plan.acceptance_criteria\[0\].description: expected string/);
  });

  it("throws when acceptance_criteria entry is missing status", () => {
    const plan = {
      ...makeValidPlan(),
      acceptance_criteria: [{ id: "ac-1", description: "desc" }],
    };
    assert.throws(() => validatePlan(plan), /Invalid plan.acceptance_criteria\[0\].status: expected string/);
  });

  it("throws when work_units is not an array", () => {
    const plan = { ...makeValidPlan(), work_units: "none" };
    assert.throws(() => validatePlan(plan), /Invalid plan.work_units: expected array/);
  });

  it("throws when work_units entry is invalid", () => {
    const plan = {
      ...makeValidPlan(),
      work_units: [{ id: "wu-1", description: "desc", status: "pending", dependencies: [1] }],
    };
    assert.throws(
      () => validatePlan(plan),
      /Invalid plan.work_units\[0\].dependencies\[0\]: expected string/,
    );
  });
});

describe("validateWorkUnit", () => {
  it("passes for a valid work unit", () => {
    const wu = { id: "wu-1", description: "Test", status: "pending", dependencies: [] };
    const result = validateWorkUnit(wu);
    assert.deepStrictEqual(result, wu);
  });

  it("throws when work unit is not an object", () => {
    assert.throws(() => validateWorkUnit(null), /Invalid workUnit: expected object/);
    assert.throws(() => validateWorkUnit("string"), /Invalid workUnit: expected object/);
  });

  it("throws when id is missing", () => {
    const wu = { description: "Test", status: "pending", dependencies: [] };
    assert.throws(() => validateWorkUnit(wu), /Invalid workUnit.id: expected string/);
  });

  it("throws when description is missing", () => {
    const wu = { id: "wu-1", status: "pending", dependencies: [] };
    assert.throws(() => validateWorkUnit(wu), /Invalid workUnit.description: expected string/);
  });

  it("throws when status is missing", () => {
    const wu = { id: "wu-1", description: "Test", dependencies: [] };
    assert.throws(() => validateWorkUnit(wu), /Invalid workUnit.status: expected string/);
  });

  it("throws when dependencies is not an array", () => {
    const wu = { id: "wu-1", description: "Test", status: "pending", dependencies: "none" };
    assert.throws(() => validateWorkUnit(wu), /Invalid workUnit.dependencies: expected array/);
  });

  it("throws when dependencies contains non-strings", () => {
    const wu = { id: "wu-1", description: "Test", status: "pending", dependencies: [1] };
    assert.throws(
      () => validateWorkUnit(wu),
      /Invalid workUnit.dependencies\[0\]: expected string/,
    );
  });

  it("uses custom path prefix when provided", () => {
    const wu = { description: "Test", status: "pending", dependencies: [] };
    assert.throws(
      () => validateWorkUnit(wu, "plan.work_units[0]"),
      /Invalid plan.work_units\[0\].id: expected string/,
    );
  });
});
