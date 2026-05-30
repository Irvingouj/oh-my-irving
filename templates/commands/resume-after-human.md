---
description: Resume orchestration after human supplied context
agent: orchestrator
---

session_id: !`.opencode/bin/session-id`

All paths are under .opencode/irving/<session_id>/.

Human has supplied new context:

$ARGUMENTS

Record the human context using pipeline_append_human_context.

Then decide:
- whether to update plan
- whether to create revision work
- whether to continue execution

Call pipeline_set_next_action with the session_id and appropriate next_action.
