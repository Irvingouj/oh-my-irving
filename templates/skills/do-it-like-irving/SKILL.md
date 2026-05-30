---
name: do-it-like-irving
description: "Execute work with Irving's standard: define the real expected product behavior first, then make strict black-box tests express that behavior, and only then change the implementation until it satisfies those tests without shortcuts, fake state, or false-green compromises."
license: MIT
compatibility: opencode
metadata:
  audience: developers
  workflow: product-behavior-first
  style: strict-black-box
---

# Do It Like Irving

This skill encodes a strict engineering standard:

- Start from the real product behavior, not from code structure.
- Make tests express that behavior as directly and realistically as possible.
- Make the implementation satisfy those tests.
- Do not call work done until expected behavior and implementation agree.

## When To Use

Use this skill when:

- fixing failing backend API tests
- deciding whether to change a test or production code
- reviewing authorization, scope, role, capability, or lifecycle behavior
- debugging flaky or misleading tests
- coordinating workers who keep drifting into false-green shortcuts
- evaluating whether a branch is really done

## Core Standard

The goal is not "green tests."

The goal is:

1. identify the correct expected business behavior
2. make tests express that behavior truthfully
3. make the implementation satisfy those tests

If a test is green because the setup is fake, the permissions were patched at runtime, or the assertion was weakened to fit broken behavior, the work is not done.

## The Irving Questions

Before changing code or tests, answer these:

1. Who wants to do what?
2. What or who is affected?
3. What should the affected party see, and what must remain forbidden, hidden, filtered, or unchanged?

If these are not clear, stop and clarify the behavior before editing code.

## Behavioral Priorities

Always reason in this order:

1. Real user journey
2. Real persona and identity
3. Real public API path
4. Real authorization and provisioning path
5. Real observable result
6. Only then implementation details

Never invert this into:

1. table field
2. enum
3. role key
4. menu id
5. current controller annotation
6. "therefore the product should behave this way"

## Hard Rules

### Tests Must Stay Honest

- Do not weaken a test just to pass.
- Do not change expected behavior to match broken implementation unless you have concluded the test was asserting the wrong product behavior.
- Do not leave knowingly-red tests in CI as "documentation."
- Do not mark something blocked until you have tried real routes to create the needed state.

### Use Real Paths

- Prefer real public API entrypoints.
- Prefer real login flows.
- Prefer real provisioning and migration paths.
- Prefer real persona bootstrap helpers only when they still drive the same public surfaces a real user depends on.

### Forbidden Shortcuts

- direct DB patching to make tests pass
- runtime permission injection in tests
- fake identity headers for the final actor
- service-layer shortcut calls when the product uses a public API
- seed endpoints to fabricate the final business state under test
- "PASS + FIXME" for clearly broken behavior

### Black-Box Standard

The test should fail for the real reason.

If the real product would fail but the test still passes, the test setup is wrong.

If the test only passes because it bypasses the path under verification, the test is wrong.

## Authorization and Scope Standard

When the work touches permissions, always separate:

- route or menu visibility
- action permission
- data/query filtering
- lifecycle/state transition permission

Do not assume one implies the others.

Prefer a single canonical truth source.

Examples:

- capability should be the runtime truth source
- menu should be a UI projection, not a second permission model
- builtin role permissions should come from real provisioning, not test-time patching

## How To Decide Between Changing Tests vs Implementation

### Change The Test If

- the test asserts the wrong product behavior
- the test uses the wrong persona
- the test expects 403 where the real behavior is 200 + filtered
- the test assumes a fake lifecycle the product never exposes
- the test uses stale fixture IDs instead of the runtime identity it just bootstrapped

### Change The Implementation If

- the test expresses the real product behavior
- the implementation returns the wrong auth result
- the provisioning path fails to give a real persona the capabilities it should have
- the implementation leaks or hides data against the intended scope
- the implementation only works if tests patch state behind the scenes

## Worker Guidance

When coordinating another agent:

- do not accept vague "done"
- do not accept "it is probably a product gap" without proof
- do not accept "blocked" without real attempted paths
- do not accept summaries without exact failing request/response evidence

Push workers to:

1. state the first real failing request
2. explain the expected behavior in product terms
3. explain whether the test or implementation is wrong
4. fix only the current concrete failure
5. rerun the smallest relevant set first
6. then expand verification

## Review Standard

When reviewing work, ask:

1. Do the tests express correct expected behavior?
2. Does the implementation satisfy those tests?
3. Were the tests weakened just to pass?
4. Is there any fake setup, fake identity, DB patching, runtime permission patching, or hidden shortcut?
5. Are there two competing truth sources where one should exist?

Findings should prioritize:

- bugs
- incorrect behavior
- authorization or data-scope regressions
- false-green tests
- missing test coverage for the claimed fix

## Signs Of Bad Work

- "all green" but only after direct SQL updates
- "done" with `FIXME` on the core broken path
- blocked tests where no real path was attempted
- assertions widened to allow both 200 and 403
- helper methods growing into state-repair scripts
- dual truth sources introduced during refactor
- repeated asking for direction instead of advancing from the first concrete failure

## Signs Of Good Work

- root cause stated in product terms and code terms
- the failing path is reproduced concretely
- the fix lands in the canonical runtime/provisioning path
- tests become stricter, not weaker
- fresh-environment reruns are green
- review can explain why the behavior is right, not just why the tests pass

## One-Line Summary

Do it like Irving:

Figure out the true expected behavior first, make tests state that behavior honestly through real black-box paths, then keep fixing the implementation until those tests pass for the real reason.