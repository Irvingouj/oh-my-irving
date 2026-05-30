---
description: Start or continue LLM orchestration loop
agent: orchestrator
---

First call irving_session. Use the returned session_id and base_path for every path below.

All paths are under <base_path>/.

Start or continue the implementation orchestration loop.

Preconditions:
- <base_path>/context-pack.md exists
- <base_path>/plan.json exists

At the start of orchestration:
1. Read state with pipeline_read_state.
2. If phase is "planning" and planning.status is NOT "approved":
   - Call pipeline_set_next_action with next_action = "needs_human"
   - Reason: "Plan not approved. Run irving:debate first."
   - Stop. Do not proceed to execution.
3. Only proceed if the plan is approved.

Loop until all acceptance criteria are satisfied:
1. Read state.
2. Read work unit files from work-units/*.md and parse YAML frontmatter for id, title, status, and dependencies.
3. Select next logical work unit(s), respecting the dependencies field in frontmatter.
4. Delegate to implementer.
5. Delegate completed work to cheap-reviewer.
6. Evaluate findings.
7. Create revision work for valid major/blocker findings.
8. Record ignored findings with reason.
9. Run relevant verification.
10. Record acceptance evidence.
11. Continue.

Stop and ask human only when:
- product behavior is ambiguous
- acceptance criteria need to change
- plan/objective needs to change
- expensive-reviewer should be invoked
