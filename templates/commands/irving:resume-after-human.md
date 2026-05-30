---
description: Resume orchestration after human supplied context
agent: orchestrator
---

First call irving_session. Use the returned session_id and base_path for every path below.

All paths are under <base_path>/.

Human has supplied new context:

$ARGUMENTS

Record the human context using pipeline_append_human_context.

Then decide:
- whether to update plan
- whether to create revision work
- whether to continue execution

Call pipeline_set_next_action with the session_id and appropriate next_action.
