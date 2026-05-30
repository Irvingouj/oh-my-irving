---
description: Run exactly one orchestration iteration
agent: orchestrator
---

session_id: !`.opencode/bin/session-id`

All paths are under .opencode/irving/<session_id>/. Use this session_id for all pipeline tool calls.

Do one of the following, and only one:

1. Select ready work unit(s) and delegate to implementer.
2. Review completed work by delegating to cheap-reviewer.
3. Evaluate reviewer findings.
4. Create revision work.
5. Run/record verification evidence.
6. Mark acceptance criteria satisfied if evidence exists.
7. Request expensive review if all ACs are satisfied.
8. Ask human only if blocked by product/design ambiguity.

When delegating to subagents, always include the session_id.

At the end, call pipeline_set_next_action with:
- session_id
- next_action
- reason
- blocking_question if human input is required

Do not claim the workflow is complete unless all acceptance criteria have evidence.
Do not continue into a second iteration.
