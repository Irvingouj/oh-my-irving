---
description: Run exactly one orchestration iteration
agent: orchestrator
---

Call irving_session once. Use the returned base_path for every path below.

At the start of every iteration:
1. Call irving_status.
2. If phase is "planning" and planning.status is NOT "approved":
   - Call irving_next with "blocked"
   - Reason: "Plan not approved. Run irving:debate first."
   - Stop. Do not proceed.
3. Only continue if the plan is approved.

Do one of the following, and only one:

1. Read work unit files from work-units/*.md, parse YAML frontmatter for dependencies, and select ready work unit(s) to delegate to **implementer** (first round only — no prior reviews exist).
2. Delegate completed work to the 7 specialized reviewers.
3. Synthesize reviewer findings. Decide: accept, skip, or fix.
4. If major/blocker findings remain AND round < 4: delegate to **review-fixer**. Pass work unit ID and round number.
5. If round >= 4: accept current state, record concerns.
6. Record verification evidence via irving_evidence.
7. Record skipped findings via irving_skip.
8. Mark acceptance criteria satisfied if evidence exists.
9. Request expensive review if all ACs are satisfied.
10. Ask human only if blocked by product/design ambiguity.

Do not invoke architect or skeptic during normal execution. They are planning-phase agents.
If the approved plan is invalid, incomplete, or needs architectural debate, do not quietly replan.
Call irving_next with "blocked" and explain the replanning question.

When delegating to subagents, always include the session_id.

At the end, call irving_next with the action and why.

If state already shows next_action is "blocked" and no new context arrived, do NOT call irving_next again. Just output: "Blocked: <reason>. Awaiting your input." and stop.

**Human approval gate:** accepted and ready_for_final_review require at least one human reply since the last state transition. If blocked by the gate, output plain text to the human explaining what you need and wait.

Do not claim the workflow is complete unless all acceptance criteria have evidence.
Do not continue into a second iteration.
