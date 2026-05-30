import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  ensureDirs,
  logsDir,
  statePath,
  planPath,
} from "./session.js";
import { validateState, validatePlan } from "./schema.js";

export type Phase = "init" | "discovery" | "planning" | "execution" | "final_review" | "accepted" | "blocked";

export type NextAction = "continue" | "needs_human" | "ready_for_final_review" | "accepted" | "blocked" | "failed";

export type State = {
  version: 1;
  session_id: string;
  phase: Phase;
  planning: {
    status: string;
    round: number;
  };
  execution: {
    status: string;
    iteration: number;
    next_action: NextAction;
    reason: string;
    blocking_question: string | null;
    last_error: string | null;
    active_work_units: string[];
    blocked_work_units: string[];
    ignored_findings: Array<{
      finding_id: string;
      reason: string;
    }>;
    evidence: Array<{
      ac_id: string;
      type: "test" | "review" | "manual" | "static";
      detail: string;
    }>;
  };
};

export type Plan = {
  objective: string;
  acceptance_criteria: Array<{
    id: string;
    description: string;
    status: string;
  }>;
  work_units: Array<{
    id: string;
    description: string;
    status: string;
    dependencies: string[];
  }>;
};

export async function readStateFile(root: string, sessionId: string): Promise<State> {
  await ensureDirs(root, sessionId);
  const file = statePath(root, sessionId);
  if (!existsSync(file)) {
    return validateState({
      version: 1,
      session_id: sessionId,
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
      },
    });
  }
  const parsed = JSON.parse(await readFile(file, "utf8"));
  return validateState(parsed);
}

export async function writeStateFile(root: string, sessionId: string, state: State) {
  await ensureDirs(root, sessionId);
  const validated = validateState(state);
  await writeFile(statePath(root, sessionId), JSON.stringify(validated, null, 2) + "\n", "utf8");
}

export async function readPlanFile(root: string, sessionId: string): Promise<Plan> {
  await ensureDirs(root, sessionId);
  const file = planPath(root, sessionId);
  if (!existsSync(file)) {
    throw new Error("plan.json does not exist yet");
  }
  const parsed = JSON.parse(await readFile(file, "utf8"));
  return validatePlan(parsed);
}

export async function writePlanFile(root: string, sessionId: string, plan: Plan) {
  await ensureDirs(root, sessionId);
  const validated = validatePlan(plan);
  await writeFile(planPath(root, sessionId), JSON.stringify(validated, null, 2) + "\n", "utf8");
}

export async function logEvent(root: string, sessionId: string, event: Record<string, unknown>) {
  await ensureDirs(root, sessionId);
  await appendFile(
    path.join(logsDir(root, sessionId), "events.jsonl"),
    JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + "\n",
    "utf8",
  );
}
