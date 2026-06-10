---
description: Run expensive final review and update orchestration state
agent: orchestrator
---

First call irving_session. Use the returned session_id and base_path for every path below.

All paths are under <base_path>/.

Invoke expensive-reviewer. Pass it the session_id.
The expensive-reviewer writes its output to <base_path>/reviews/final-review.md.

After expensive review:

If final reviewer says ACCEPT:
- Enter the review loop:
  - Run /fire-reviewer
  - If no problems found: break the loop
  - If problems found: run /fire-fixer, then repeat the loop
- Once the loop exits clean:
  - set next_action = blocked
  - ask human for final approval

If final reviewer says REVISE:
- Enter the review loop:
  - Run /fire-reviewer
  - If no problems found: break the loop
  - If problems found: run /fire-fixer, then repeat the loop
- Once the loop exits clean:
  - convert any remaining findings into new work units
  - set next_action = continue

If final reviewer says REJECT:
- set next_action = blocked
- explain why
