## Why

The repository's tests grew organically around feature delivery, so they now mix several different concerns under one `*.spec.ts` convention: non-UI behavior, UI rendering checks, browser e2e flows, architecture guards, and source-scan policy checks. That makes it difficult to reason about coverage, choose the right seam for new tests, and raise confidence in non-UI code without inflating the suite with static or UI-adjacent checks.

The team now wants a strong coverage target for code that does not touch the UI. That requires a durable test architecture before more feature work and OpenSpec growth lock in today's ad hoc placement patterns.

## What Changes

- Introduce an explicit repository test architecture with four lanes: `logic`, `ui`, `e2e`, and `static`, including ownership and placement rules for each lane.
- Define a seam-based non-UI testing policy for `contracts`, `core`, `domain`, `application`, and appropriate `infrastructure` modules so new coverage is added at exported boundaries instead of wherever code happens to be convenient.
- Refactor the existing test suite to reclassify misplaced policy checks, separate static guards from behavioral tests, and reduce the current mixing of non-UI, UI, and guard concerns under one undifferentiated spec surface.
- Establish shared seam fixtures and helpers for recurring non-UI boundaries such as contract payloads, service ports, repositories, extension registries, and adapter contracts, and use them to retire one-off file-local harness patterns where they obscure the seam.
- Add lane-aware test execution and coverage reporting so the repository can measure non-UI behavior independently from UI tests and static policy checks.
- Align repository guidance and automation by updating documentation, agent instructions, and executable checks to follow the same seam-based testing model.

## Capabilities

### New Capabilities
- `test-suite-architecture`: Repository-wide test lane taxonomy and seam-based placement policy for logic, UI, e2e, and static checks, including separate non-UI coverage scope.

### Modified Capabilities
- `bun-test-harness`: The Bun-managed non-e2e harness requirements change to support lane-aware execution and coverage workflows instead of treating all non-Playwright specs as one undifferentiated suite.

## Impact

- **Code:** Test files across `src/` will be reclassified, renamed, or relocated to match the lane model. Shared seam fixtures and guard locations will be introduced or consolidated.
- **Tooling:** `package.json`, Bun coverage/reporting commands, and CI/test workflows will be updated to expose lane-aware execution and non-UI coverage measurement.
- **Docs and process:** `docs/testing.md`, `AGENTS.md`, and related contributor guidance will become the human-facing expression of the new lane and seam policy.
- **OpenSpec:** A new governing testing capability will be added, and the existing `bun-test-harness` capability will be updated to match the refactored suite shape.
- **Risk:** Existing test paths and developer muscle memory will change. The design must keep migration incremental and preserve a green suite throughout the refactor.
