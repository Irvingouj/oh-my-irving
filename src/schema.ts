import type { State, Plan, Phase, NextAction } from "./state.js";

const PHASES: readonly Phase[] = [
  "init",
  "discovery",
  "planning",
  "execution",
  "final_review",
  "accepted",
  "blocked",
];

const NEXT_ACTIONS: readonly NextAction[] = [
  "continue",
  "ready_for_final_review",
  "accepted",
  "blocked",
  "failed",
];

const EVIDENCE_TYPES = ["test", "review", "manual", "static"] as const;

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${field}: expected string, got ${typeof value}`);
  }
  return value;
}

function assertNumber(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new Error(`Invalid ${field}: expected number, got ${typeof value}`);
  }
  return value;
}

function assertArrayOfStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${field}: expected array, got ${typeof value}`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      throw new Error(
        `Invalid ${field}[${i}]: expected string, got ${typeof value[i]}`,
      );
    }
  }
  return value as string[];
}

function assertOneOf<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  const str = assertString(value, field);
  if (!allowed.includes(str as T)) {
    throw new Error(
      `Invalid ${field}: must be one of ${allowed.join(", ")}, got "${str}"`,
    );
  }
  return str as T;
}

export type WorkUnit = {
  id: string;
  description: string;
  status: string;
  dependencies: string[];
};

export function validateState(state: unknown): State {
  if (state === null || typeof state !== "object") {
    throw new Error("Invalid state: expected object, got " + typeof state);
  }
  const s = state as Record<string, unknown>;

  const version = assertNumber(s.version, "state.version");
  if (version !== 1) {
    throw new Error(`Invalid state.version: must be 1, got ${version}`);
  }

  const session_id = assertString(s.session_id, "state.session_id");
  const phase = assertOneOf(s.phase, "state.phase", PHASES);

  if (s.planning === null || typeof s.planning !== "object") {
    throw new Error(
      "Invalid state.planning: expected object, got " + typeof s.planning,
    );
  }
  const planning = s.planning as Record<string, unknown>;
  const planningStatus = assertString(
    planning.status,
    "state.planning.status",
  );
  const planningRound = assertNumber(planning.round, "state.planning.round");

  if (s.execution === null || typeof s.execution !== "object") {
    throw new Error(
      "Invalid state.execution: expected object, got " + typeof s.execution,
    );
  }
  const execution = s.execution as Record<string, unknown>;
  const executionStatus = assertString(
    execution.status,
    "state.execution.status",
  );
  const executionIteration = assertNumber(
    execution.iteration,
    "state.execution.iteration",
  );
  const next_action = assertOneOf(
    execution.next_action,
    "state.execution.next_action",
    NEXT_ACTIONS,
  );

  const active_work_units = assertArrayOfStrings(
    execution.active_work_units,
    "state.execution.active_work_units",
  );
  const blocked_work_units = assertArrayOfStrings(
    execution.blocked_work_units,
    "state.execution.blocked_work_units",
  );

  // Optional fields with defaults for backward compatibility
  const reason =
    typeof execution.reason === "string" ? execution.reason : "";
  const blocking_question =
    execution.blocking_question === null ||
    execution.blocking_question === undefined
      ? null
      : typeof execution.blocking_question === "string"
        ? execution.blocking_question
        : null;
  const last_error =
    execution.last_error === null || execution.last_error === undefined
      ? null
      : typeof execution.last_error === "string"
        ? execution.last_error
        : null;

  const ignored_findings = Array.isArray(execution.ignored_findings)
    ? execution.ignored_findings.map((f, i) => {
        if (f === null || typeof f !== "object") {
          throw new Error(
            `Invalid state.execution.ignored_findings[${i}]: expected object`,
          );
        }
        const fi = f as Record<string, unknown>;
        return {
          finding_id: assertString(
            fi.finding_id,
            `state.execution.ignored_findings[${i}].finding_id`,
          ),
          reason: assertString(
            fi.reason,
            `state.execution.ignored_findings[${i}].reason`,
          ),
        };
      })
    : [];

  const evidence = Array.isArray(execution.evidence)
    ? execution.evidence.map((e, i) => {
        if (e === null || typeof e !== "object") {
          throw new Error(
            `Invalid state.execution.evidence[${i}]: expected object`,
          );
        }
        const ei = e as Record<string, unknown>;
        const type = assertString(
          ei.type,
          `state.execution.evidence[${i}].type`,
        );
        if (!EVIDENCE_TYPES.includes(type as (typeof EVIDENCE_TYPES)[number])) {
          throw new Error(
            `Invalid state.execution.evidence[${i}].type: must be one of ${EVIDENCE_TYPES.join(", ")}, got "${type}"`,
          );
        }
        return {
          ac_id: assertString(
            ei.ac_id,
            `state.execution.evidence[${i}].ac_id`,
          ),
          type: type as "test" | "review" | "manual" | "static",
          detail: assertString(
            ei.detail,
            `state.execution.evidence[${i}].detail`,
          ),
          files: Array.isArray(ei.files) ? assertArrayOfStrings(ei.files, `state.execution.evidence[${i}].files`) : undefined,
        };
      })
    : [];

  const findings = Array.isArray(execution.findings)
    ? execution.findings.map((f, i) => {
        if (f === null || typeof f !== "object") {
          throw new Error(
            `Invalid state.execution.findings[${i}]: expected object`,
          );
        }
        const fi = f as Record<string, unknown>;
        return {
          finding_id: assertString(fi.finding_id, `state.execution.findings[${i}].finding_id`),
          wu_id: assertString(fi.wu_id, `state.execution.findings[${i}].wu_id`),
          reviewer: assertString(fi.reviewer, `state.execution.findings[${i}].reviewer`),
          severity: assertString(fi.severity, `state.execution.findings[${i}].severity`),
          claim: assertString(fi.claim, `state.execution.findings[${i}].claim`),
          evidence: assertString(fi.evidence, `state.execution.findings[${i}].evidence`),
          status: assertString(fi.status, `state.execution.findings[${i}].status`),
          category: typeof fi.category === "string" ? fi.category : undefined,
          file: typeof fi.file === "string" ? fi.file : undefined,
          line: typeof fi.line === "number" ? fi.line : undefined,
        };
      })
    : [];

  return {
    version: 1,
    session_id,
    phase,
    planning: {
      status: planningStatus,
      round: planningRound,
    },
    execution: {
      status: executionStatus,
      iteration: executionIteration,
      next_action,
      reason,
      blocking_question,
      last_error,
      active_work_units,
      blocked_work_units,
      ignored_findings,
      evidence,
      findings,
    },
  };
}

export function validatePlan(plan: unknown): Plan {
  if (plan === null || typeof plan !== "object") {
    throw new Error("Invalid plan: expected object, got " + typeof plan);
  }
  const p = plan as Record<string, unknown>;

  const objective = assertString(p.objective, "plan.objective");

  if (!Array.isArray(p.acceptance_criteria)) {
    throw new Error(
      "Invalid plan.acceptance_criteria: expected array, got " +
        typeof p.acceptance_criteria,
    );
  }
  const acceptance_criteria = p.acceptance_criteria.map((ac, i) => {
    if (ac === null || typeof ac !== "object") {
      throw new Error(
        `Invalid plan.acceptance_criteria[${i}]: expected object`,
      );
    }
    const aci = ac as Record<string, unknown>;
    return {
      id: assertString(aci.id, `plan.acceptance_criteria[${i}].id`),
      description: assertString(
        aci.description,
        `plan.acceptance_criteria[${i}].description`,
      ),
      status: assertString(aci.status, `plan.acceptance_criteria[${i}].status`),
    };
  });

  if (!Array.isArray(p.work_units)) {
    throw new Error(
      "Invalid plan.work_units: expected array, got " + typeof p.work_units,
    );
  }
  const work_units = p.work_units.map((wu, i) =>
    validateWorkUnit(wu, `plan.work_units[${i}]`),
  );

  const preflight = (p.preflight === null || p.preflight === undefined || typeof p.preflight !== "object")
    ? undefined
    : Object.fromEntries(
        Object.entries(p.preflight as Record<string, unknown>)
          .filter(([_, v]) => typeof v === "string")
      );

  return {
    objective,
    acceptance_criteria,
    work_units,
    ...(preflight && Object.keys(preflight).length > 0 && { preflight: preflight as Record<string, string> }),
  };
}

export function validateWorkUnit(
  workUnit: unknown,
  path = "workUnit",
): WorkUnit {
  if (workUnit === null || typeof workUnit !== "object") {
    throw new Error(
      `Invalid ${path}: expected object, got ${typeof workUnit}`,
    );
  }
  const wu = workUnit as Record<string, unknown>;
  return {
    id: assertString(wu.id, `${path}.id`),
    description: assertString(wu.description, `${path}.description`),
    status: assertString(wu.status, `${path}.status`),
    dependencies: assertArrayOfStrings(wu.dependencies, `${path}.dependencies`),
  };
}
