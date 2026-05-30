---
description: Run expensive final review and update orchestration state
agent: orchestrator
---

First call irving_session. Use the returned session_id and base_path for every path below.

All paths are under <base_path>/.

Invoke expensive-reviewer. Pass it the session_id.

After expensive review:

If final reviewer says ACCEPT:
- set next_action = needs_human
- ask human for final approval

If final reviewer says REVISE:
- convert findings into new work units
- set next_action = continue

If final reviewer says REJECT:
- set next_action = blocked
- explain why
