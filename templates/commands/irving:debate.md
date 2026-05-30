---
description: Run Architect/Skeptic planning loop with human context gate
agent: orchestrator
---

First call irving_session. Use the returned session_id and base_path for every path below.

All paths are under <base_path>/.

Run the planning debate loop.

Read:
- <base_path>/context-pack.md
- <base_path>/debate/** if present
- any human context in this conversation

Process:
1. Read the current context pack and any previous debate artifacts.
2. Delegate exactly one Task to architect to produce the next design proposal.
3. Wait for the architect result before doing anything else.
4. Delegate exactly one Task to skeptic to review the architect proposal.
5. Wait for the skeptic result before doing anything else.
6. Synthesize the result into a debate round.
7. Ask human whether to:
   - provide more context
   - ask for another design round
   - accept the direction and draft plan

You must actually delegate to architect and skeptic. Do not impersonate either role yourself.
Use exactly one architect task and exactly one skeptic task per debate round. Do not spawn parallel architects or parallel skeptics.
When delegating to architect, include:
- session_id
- the exact planning question for this round
- the context pack path
- the latest human context, if any
- permission to inspect the repo with read/grep/glob/list when the context pack is incomplete
When delegating to skeptic, include:
- session_id
- the exact planning question for this round
- the context pack path
- the architect proposal path or summary
- permission to inspect the repo with read/grep/glob/list to validate claims

Do not ask the human questions that are answerable by reading files or inspecting the repo.
Ask the human only for product, business, or acceptance-criteria ambiguity.

If human accepts the direction:
- use pipeline_create_plan to create <base_path>/plan.json
- include objective, non-goals, acceptance criteria, dependency-ordered work units
- set human_approval.status = "not_approved"

Do not start implementation.
