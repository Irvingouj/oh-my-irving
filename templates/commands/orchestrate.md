---
description: Start or continue LLM orchestration loop
agent: orchestrator
---

session_id: !`.opencode/bin/session-id`

All paths are under .opencode/irving/<session_id>/.

Start or continue the implementation orchestration loop.

Preconditions:
- .opencode/irving/<session_id>/context-pack.md exists
- .opencode/irving/<session_id>/plan.json exists
- .opencode/irving/<session_id>/plan.json human_approval.status is "approved"

Loop until all acceptance criteria are satisfied:
1. Read state.
2. Select next logical work unit(s), respecting dependencies.
3. Delegate to implementer.
4. Delegate completed work to cheap-reviewer.
5. Evaluate findings.
6. Create revision work for valid major/blocker findings.
7. Record ignored findings with reason.
8. Run relevant verification.
9. Record acceptance evidence.
10. Continue.

Stop and ask human only when:
- product behavior is ambiguous
- acceptance criteria need to change
- plan/objective needs to change
- expensive-reviewer should be invoked
