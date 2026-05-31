---
description: Resume orchestration after human supplied context
agent: orchestrator
---

Call irving_session once. Use the returned base_path for every path below.

All paths are under <base_path>/.

Human has supplied new context:

$ARGUMENTS

Record the human context using irving_note with kind "human_context".

Then decide:
- whether to update plan
- whether to create revision work
- whether to continue execution

Call irving_next with the appropriate action and why.
