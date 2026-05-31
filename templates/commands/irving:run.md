---
description: Run the full Irving pipeline end-to-end — discovery, debate, implementation, review
agent: orchestrator
---

Call irving_session once. Use the returned base_path for every path below.

All paths are under <base_path>/.

You own the entire pipeline from start to finish. The user's task is: $ARGUMENTS

## Phase 1: Discovery

If <base_path>/context-pack.md does NOT exist:
1. Call irving_advance with "discovery".
2. Delegate exactly one Task to the discoverer agent with the user's task as input.
3. Wait for discoverer to complete.
4. If discoverer produced a BLOCKED context pack (task too vague), call irving_next with "needs_human" and STOP.
5. Once context-pack.md exists, proceed to Phase 2.

## Phase 2: Planning (Debate)

If <base_path>/plan.json does NOT exist or planning.status is NOT "approved":
1. Call irving_advance with "planning".
2. Run the debate loop:
   a. Delegate exactly one Task to architect to produce a design proposal.
   b. Wait for architect to complete.
   c. Delegate exactly one Task to skeptic to attack the proposal.
   d. Wait for skeptic to complete.
   e. If both agree OR convergence detected OR 8 rounds reached, stop.
3. Use the grill-me skill to interview the human about the plan before freezing it.
4. Once human approves:
   - Call irving_plan with objective, criteria, and units.
   - Call irving_advance with "approved" to mark planning done.
5. Proceed to Phase 3.

Do not ask the human questions that are answerable from the repo.
Use exactly one architect and one skeptic per round. Never parallel.

## Phase 3: Execution

Call irving_advance with "execution".

1. Call irving_work_unit for each work unit in the plan.
2. Loop per work unit (max 4 review rounds per work unit):
   a. Call irving_status to read state. Parse work-units/*.md for status and dependencies.
   b. Select ready work unit(s) respecting dependency order.
   c. **Round 1:** Delegate to implementer.
   d. After implementation, delegate completed work to the 6 reviewers.
   e. Synthesize findings.
   f. If major/blocker findings remain AND round < 4: delegate to **review-fixer**. Pass the work unit ID and round number.
   g. After review-fixer completes, go back to (d) — delegate to reviewers again.
   h. If all findings addressed/ignored OR max rounds reached: record evidence via irving_evidence, skip invalid findings via irving_skip.
   i. After round 3: only blocker findings justify another round. Accept major-level issues or skip them.
   j. After round 4: accept current state regardless. Record remaining concerns.
   k. If all ACs across all work units have strong evidence AND the product goal is met, proceed to Phase 4.
   l. Otherwise call irving_next with "continue".

## Phase 4: Final Review

1. Call irving_advance with "final_review".
2. Delegate to expensive-reviewer for final gate.
3. Ask human for final sign-off.
4. Once accepted, call irving_advance with "accepted" and irving_next with "accepted".

## Rules

- Call irving_next at the end of every invocation.
- After calling irving_next with "needs_human", STOP the loop. Do not iterate further. The user must resume via /irving:resume-after-human or by providing new context.
- Never skip phases. Never skip the human approval gates.
- Never impersonate architect, skeptic, discoverer, reviewers, or review-fixer. Always delegate via Task.
- Never set action "accepted" unless every AC has strong evidence AND human approved.
