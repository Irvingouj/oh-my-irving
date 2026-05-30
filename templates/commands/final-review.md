---
description: Run expensive final review and update orchestration state
agent: orchestrator
---

session_id: !`.opencode/bin/session-id`

All paths are under .opencode/irving/<session_id>/.

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
