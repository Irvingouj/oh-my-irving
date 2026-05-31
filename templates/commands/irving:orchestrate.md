---
description: Start or continue LLM orchestration loop
agent: orchestrator
---

Call irving_session once. Use the returned base_path for every path below.

All paths are under <base_path>/.

Start or continue the implementation orchestration loop.

Preconditions:
- <base_path>/context-pack.md exists
- <base_path>/plan.json exists

At the start of orchestration:
1. Call irving_status.
2. If phase is "planning" and planning.status is NOT "approved":
   - Call irving_next with "needs_human"
   - Reason: "Plan not approved. Run irving:debate first."
   - Stop. Do not proceed to execution.
3. Only proceed if the plan is approved.

Loop until all acceptance criteria are satisfied (max 4 review rounds per work unit):
1. Call irving_status.
2. Read work unit files from work-units/*.md and parse YAML frontmatter for id, title, status, and dependencies.
3. Select next logical work unit(s), respecting the dependencies field in frontmatter.
4. If no prior reviews exist for this work unit: delegate to **implementer**.
5. If review-fixer just completed or reviews exist but prior fix was done: check review round count.
6. Delegate completed work to the 6 specialized reviewers.
7. Evaluate findings.
8. If major/blocker findings remain AND round < 4: delegate to **review-fixer**. Pass work unit ID and round number.
9. If major/blocker findings remain AND round >= 4: accept current state, record concerns.
10. After round 3: only blocker findings justify another round.
11. Record ignored findings via irving_skip.
12. Record acceptance evidence via irving_evidence.
13. Continue.

Stop and ask human only when:
- product behavior is ambiguous
- acceptance criteria need to change
- plan/objective needs to change
- expensive-reviewer should be invoked

**Critical:** After calling irving_next with "needs_human", STOP the loop. Do not iterate further. The user must provide new context or run /irving:resume-after-human.
