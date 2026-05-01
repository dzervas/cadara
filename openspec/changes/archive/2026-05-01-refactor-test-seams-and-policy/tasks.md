## 1. Establish lane-aware test entrypoints

- [x] 1.1 Update `package.json` to expose explicit Bun-side lane commands for `logic`, `ui`, and `static`, while preserving umbrella `test` and existing `test:e2e` entrypoints.
- [x] 1.2 Update `test:all` and any related local/CI workflows so they reflect the lane model instead of assuming one flat `bun test src` suite.
- [x] 1.3 Align contributor-facing guidance (`docs/testing.md`, `AGENTS.md`, and any adjacent test docs) with the final command names and lane definitions used by the implementation.
- [x] 1.4 Verify each lane command runs and that the umbrella `test` command still provides a sane default workflow.

## 2. Create the static-guard surface and migrate source-scan policy checks

- [x] 2.1 Create a dedicated static-check surface (for example `test/static/`) for repository-level architecture and source-scan guards.
- [x] 2.2 Move or rewrite the current cross-cutting guard specs into the static lane, including `src/layer-architecture-boundary.spec.ts`, `src/contracts/contracts-domain-boundary.spec.ts`, `src/contracts/errors/no-empty-catch.spec.ts`, `src/contracts/errors/vendor-isolation.spec.ts`, `src/theme/workbench-theme-regression.spec.ts`, `src/app/workbench-architecture-boundary.spec.ts`, and `src/domain/modeling/document-repository-boundary.spec.ts`.
- [x] 2.3 Decide whether `src/App.preload.spec.ts` and `src/build-config.spec.ts` remain behavioral smoke tests or become part of the dedicated policy/guard surface, then place them accordingly.
- [x] 2.4 Verify the static lane can run independently and that these guards no longer distort non-UI behavioral coverage.

## 3. Reclassify Bun-managed specs into logic and UI lanes

- [x] 3.1 Define the logic-lane execution roots for `src/contracts`, `src/core`, `src/domain`, `src/application`, and appropriate `src/infrastructure` modules.
- [x] 3.2 Define the UI-lane execution roots for `src/app`, `src/components`, and `src/hooks`.
- [x] 3.3 Audit ambiguous specs under mixed-support areas such as `src/lib`, `src/theme`, and any browser-adjacent `src/infrastructure` modules, then classify or relocate them to the correct lane.
- [x] 3.4 Rename or move any outlier tests whose current location hides their real subject (for example, behavioral tests that read like guards or policy checks that still sit beside runtime behavior).
- [x] 3.5 Verify the refactored logic and UI lanes both pass after the reclassification.

## 4. Consolidate shared seam fixtures without creating a new harness monolith

- [x] 4.1 Preserve the existing Playwright seam helpers in `e2e/helpers/` and keep `src/app/workbench/cad-test-bridge.ts` as the browser-state seam behind e2e flows.
- [x] 4.2 Inventory repeated non-UI seam setup across the current Bun suite and extract only the reusable boundaries, prioritizing contract payload builders, service-port fakes, repository fixtures, registry-composition helpers, and adapter contract assertions.
- [x] 4.3 Keep area-local setup local when it is only used by one module or one tightly related test group, rather than forcing it into a global helper layer.
- [x] 4.4 Convert the highest-value repeated setup first, including existing cross-suite helpers like `src/domain/modeling/geometry-asset-test-helpers.ts`, and verify the affected tests still read primarily through their exported seam.

## 5. Seed the missing seam coverage in under-tested non-UI layers

- [x] 5.1 Inventory `src/application` modules and identify the highest-value orchestration seams that currently lack direct tests.
- [x] 5.2 Add representative application-layer seam tests that prove sequencing, retries, handoff, or error propagation through mocked or fake ports instead of only through domain or UI proxies.
- [x] 5.3 Inventory `src/infrastructure` modules and separate true adapter surfaces from browser-shell or presentation-adjacent helpers that should stay outside the non-UI target.
- [x] 5.4 Add representative infrastructure adapter tests that prove contract conformance for the selected non-UI infrastructure surfaces.
- [x] 5.5 Verify the new seam coverage improves the intended non-UI layers rather than only increasing coverage in already-dense `domain` and `contracts` areas.

## 6. Add non-UI coverage reporting and enforcement

- [x] 6.1 Add a dedicated non-UI coverage workflow that emits Bun coverage from the logic lane only.
- [x] 6.2 Ensure UI-lane and static-lane execution are excluded from the non-UI coverage metric and reported separately when needed.
- [x] 6.3 Capture the first post-refactor non-UI coverage baseline and document whether the repository will enforce a threshold immediately or report it informationally first.
- [x] 6.4 Update CI or repository automation to run the lane-aware suite and publish the non-UI coverage result without regressing ordinary local developer workflows.
