---
description: Run Architect/Skeptic planning loop with human context gate
agent: orchestrator
---

Call irving_session once. Use the returned base_path for every path below.

All paths are under <base_path>/.

Run the planning debate loop.

Read:
- <base_path>/context-pack.md
- <base_path>/debate/** if present
- any human context in this conversation

Process:
1. Call irving_status to read current state. Note planning.round.
2. Read the current context pack and any previous debate artifacts.
3. Delegate exactly one Task to architect to produce the next design proposal.
4. Wait for the architect result before doing anything else.
5. Delegate exactly one Task to skeptic to review the architect proposal.
6. Wait for the skeptic result before doing anything else.
7. Synthesize the result into a debate round.
8. Call irving_advance with "round:N" to bump the round count.

Debate limits:
- Maximum 8 debate rounds. Hard limit.
- After each round, compare the current architect proposal and skeptic objections to the previous round.
- If they are substantially the same (convergence detected), stop early.
- **Early stop on no-new-blockers:** If the skeptic has no new blocker-level objections compared to the previous round, stop and ask the human. Remaining major/minor concerns are preferences/tradeoffs the human can decide.

After each round, evaluate agreement:
- If architect and skeptic both agree (no blockers, no major objections), OR
- If convergence is detected, OR
- If max rounds (8) reached:
  - Ask human for approval of the plan direction

If max rounds reached without agreement:
  - Ask human to resolve the remaining disagreements

You must actually delegate to architect and skeptic. Do not impersonate either role yourself.
Use exactly one architect task and exactly one skeptic task per debate round. Do not spawn parallel architects or parallel skeptics.
When delegating to architect, include:
- session_id
- the exact planning question for this round
- the context pack path
- the latest human context, if any
- permission to inspect the repo with read/grep/glob/list when the context pack is incomplete
When delegating to skeptic, include:
- session_id
- the exact planning question for this round
- the context pack path
- the architect proposal path or summary
- permission to inspect the repo with read/grep/glob/list to validate claims

Do not ask the human questions that are answerable by reading files or inspecting the repo.
Ask the human only for product, business, or acceptance-criteria ambiguity.

If human accepts the direction:
- call irving_plan with objective, criteria, and units
- call irving_advance with "approved"

Do not start implementation.
The human must explicitly approve the plan before execution can start.
