---
description: Run exactly one orchestration iteration
agent: orchestrator
---

First call irving_session. Use the returned session_id and base_path for every path below.

All paths are under <base_path>/. Use this session_id for all pipeline tool calls.

At the start of every iteration:
1. Read state with pipeline_read_state.
2. If phase is "planning" and planning.status is NOT "approved":
   - Call pipeline_set_next_action with next_action = "needs_human"
   - Reason: "Plan not approved. Run irving:debate first."
   - Stop. Do not proceed.
3. Only continue if the plan is approved.

Do one of the following, and only one:

1. Read work unit files from work-units/*.md, parse YAML frontmatter for dependencies, and select ready work unit(s) to delegate to implementer.
2. Review completed work by delegating to cheap-reviewer.
3. Evaluate reviewer findings.
4. Create revision work.
5. Run/record verification evidence.
6. Mark acceptance criteria satisfied if evidence exists.
7. Request expensive review if all ACs are satisfied.
8. Ask human only if blocked by product/design ambiguity.

Do not invoke architect or skeptic during normal execution. They are planning-phase agents.
If the approved plan is invalid, incomplete, or needs architectural debate, do not quietly replan.
Set next_action = needs_human and explain the replanning question.

When delegating to subagents, always include the session_id.

At the end, call pipeline_set_next_action with:
- session_id
- next_action
- reason
- blocking_question if human input is required

Do not claim the workflow is complete unless all acceptance criteria have evidence.
Do not continue into a second iteration.
