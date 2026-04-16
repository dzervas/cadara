## 1. Feature Test Harness

- [x] 1.1 Inventory the existing extrude e2e coverage and sketch workbench helper behavior so new helpers reuse current patterns instead of duplicating setup.
- [x] 1.2 Add a lightweight feature workbench harness under `e2e/helpers/` for opening the workbench, creating deterministic profile/body fixtures, activating feature tools, editing feature form fields, selecting durable viewport targets, waiting for previews, and committing sessions.
- [x] 1.3 Add chain helpers that allow one e2e scenario to run multiple feature operations against the same document state and pass durable target context between steps.

## 2. Feature Flow Fixes

- [x] 2.1 Fix revolve feature sessions so valid profile and durable edge-backed axis selections preview and commit without runtime errors.
- [x] 2.2 Fix fillet selection by ensuring durable edges are exposed through viewport picking and accepted by the active fillet authoring filter.
- [x] 2.3 Fix shell render material assignment so preview and committed shell bodies do not flicker or retain excessive transient interior coloring.
- [x] 2.4 Fix plane feature sessions so supported construction-plane or planar-face references preview and commit without runtime errors.
- [x] 2.5 Fix boolean feature sessions so deterministic target bodies and explicit boolean scope preview and commit without runtime errors.
- [x] 2.6 Preserve existing extrude behavior while adapting any shared feature/session code.

## 3. Playwright Coverage

- [x] 3.1 Add or adapt an extrude e2e test that uses the feature harness and verifies valid preview and commit behavior.
- [x] 3.2 Add a revolve e2e test that selects a valid profile and axis, previews, and commits successfully.
- [x] 3.3 Add a fillet e2e test that selects a durable body edge in the viewport, previews, and commits successfully.
- [x] 3.4 Add a shell e2e test that selects a body and removable face, previews, commits, and verifies stable viewport coloring across consecutive frames.
- [x] 3.5 Add a plane e2e test that creates a plane from a supported reference without runtime errors.
- [x] 3.6 Add a boolean e2e test using a deterministic multi-body fixture and explicit boolean scope.
- [x] 3.7 Add at least one multi-feature chain test using the harness to prove state can flow across feature steps.

## 4. Verification

- [x] 4.1 Run focused unit or contract tests for changed feature authoring, viewport picking, render export/material, and OCC behavior.
- [x] 4.2 Run the Playwright feature e2e tests and then the full e2e suite with `bun run test:e2e`.
- [x] 4.3 Run `bun run build` after fixes are complete.
- [x] 4.4 Update the OpenSpec task list as implementation items are completed.
