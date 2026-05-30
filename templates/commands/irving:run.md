---
description: Run the full Irving pipeline end-to-end — discovery, debate, implementation, review
agent: orchestrator
---

First call irving_session. Use the returned session_id and base_path for every path below.

All paths are under <base_path>/.

You own the entire pipeline from start to finish. The user's task is: $ARGUMENTS

## Phase 1: Discovery

If <base_path>/context-pack.md does NOT exist:
1. Set phase to "discovery" via pipeline_set_phase.
2. Delegate exactly one Task to the discoverer agent with the user's task as input.
3. Wait for discoverer to complete.
4. If discoverer produced a BLOCKED context pack (task too vague), set next_action = "needs_human" with the discoverer's questions and STOP.
5. Once context-pack.md exists, proceed to Phase 2.

## Phase 2: Planning (Debate)

If <base_path>/plan.json does NOT exist or planning.status is NOT "approved":
1. Set phase to "planning" via pipeline_set_phase.
2. Run the debate loop:
   a. Delegate exactly one Task to architect to produce a design proposal.
   b. Wait for architect to complete.
   c. Delegate exactly one Task to skeptic to attack the proposal.
   d. Wait for skeptic to complete.
   e. If both agree OR convergence detected OR 8 rounds reached, stop.
3. Use the grill-me skill to interview the human about the plan before freezing it.
4. Once human approves:
   - Use pipeline_create_plan to write plan.json.
   - Use pipeline_set_planning_status with status "approved".
5. Proceed to Phase 3.

Do not ask the human questions that are answerable from the repo.
Use exactly one architect and one skeptic per round. Never parallel.

## Phase 3: Execution

Set phase to "execution" via pipeline_set_phase.

1. Materialize work unit files from plan.json using pipeline_create_work_unit_file.
2. Loop:
   a. Read state. Parse work unit files from work-units/*.md for status and dependencies.
   b. Select ready work unit(s) respecting dependency order.
   c. Delegate to implementer.
   d. Delegate completed work to the 6 reviewers: reviewer-correctness, reviewer-testing, reviewer-architecture, reviewer-security, reviewer-maintainability, reviewer-typesafe.
   e. Synthesize findings. Create revision work for real major/blocker issues. Ignore nits with recorded reasons.
   f. Record evidence for satisfied acceptance criteria.
   g. If all ACs have strong evidence AND the product goal is met, proceed to Phase 4.
   h. Otherwise set next_action = "continue" and keep looping.

## Phase 4: Final Review

1. Set phase to "final_review" via pipeline_set_phase.
2. Delegate to expensive-reviewer for final gate.
3. Ask human for final sign-off.
4. Once accepted, set phase to "accepted" and next_action = "accepted".

## Rules

- Call pipeline_set_next_action at the end of every invocation.
- Never skip phases. Never skip the human approval gates (grill-me after debate, sign-off after final review).
- Never impersonate architect, skeptic, discoverer, or reviewers. Always delegate via Task.
- Never set next_action = "accepted" unless every AC has strong evidence AND human approved.
