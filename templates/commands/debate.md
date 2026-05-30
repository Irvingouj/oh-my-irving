---
description: Run Architect/Skeptic planning loop with human context gate
agent: orchestrator
---

session_id: !`.opencode/bin/session-id`

All paths are under .opencode/irving/<session_id>/.

Run the planning debate loop.

Read:
- .opencode/irving/<session_id>/context-pack.md
- .opencode/irving/<session_id>/debate/** if present
- any human context in this conversation

Process:
1. Ask architect to produce the next design proposal.
2. Ask skeptic to review it.
3. Synthesize the result into a debate round.
4. Ask human whether to:
   - provide more context
   - ask for another design round
   - accept the direction and draft plan

If human accepts the direction:
- use pipeline_create_plan to create .opencode/irving/<session_id>/plan.json
- include objective, non-goals, acceptance criteria, dependency-ordered work units
- set human_approval.status = "not_approved"

Do not start implementation.
