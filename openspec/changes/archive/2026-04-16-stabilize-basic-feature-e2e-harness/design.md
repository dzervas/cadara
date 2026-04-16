## Context

The workbench already has OCC-backed feature definitions and Playwright coverage for sketch entry, plane picking, and preview stability. The current e2e helper is sketch-focused, while feature operations such as revolve, fillet, plane, shell, and boolean require repeatable setup of sketch profiles, body targets, face/edge picks, parameter edits, preview checks, and commit checks.

The feature failures span several boundaries: feature authoring definitions decide accepted selections, viewport/render picking exposes durable targets, the modeling adapter evaluates and commits definitions, and the Three.js scene presents the resulting topology. The implementation needs to keep those boundaries intact while adding a focused harness that exercises the workbench as a user would.

## Goals / Non-Goals

**Goals:**

- Provide a small Playwright harness for feature tests that reuses existing workbench helpers and supports composing feature chains.
- Cover extrude, revolve, fillet, shell, plane, and boolean feature flows end to end from UI activation through preview/commit verification.
- Fix invalid selection, preview, commit, and render behavior discovered by those tests, especially edge selection for fillet and shell material flicker.
- Keep feature authoring, modeling adapter behavior, and viewport/rendering concerns separated according to the existing architecture.

**Non-Goals:**

- Replace lower-level OCC unit coverage or contract tests.
- Add a new test runner, dependency, or backend service.
- Broaden the feature authoring schema beyond what is needed for the reported regressions.
- Implement unrelated CAD operations or new toolbar features.

## Decisions

- Build the harness as a thin Playwright layer under `e2e/helpers/`, not as app-only test mode state. This keeps tests close to real user flows while still allowing shared helpers for creating a profile, selecting durable targets, setting feature parameters, and committing operations. Alternative considered: exposing a large in-app fixture API, but that would bypass the UI paths that are currently failing.
- Model feature scenarios as chainable helper steps. A feature test can create a base sketch/body once, then append operations such as extrude, fillet, shell, plane, revolve, or boolean against durable targets. Alternative considered: one-off duplicated test setup per feature, but that would make boolean and downstream topology regressions harder to cover.
- Fix selection at the authoring/filter and picking layers rather than special-casing fillet UI controls. Fillet depends on durable edge targets, so edge pickability must be true for any feature session that declares an edge selection filter. Alternative considered: manual edge id injection into the form, but that would leave the viewport interaction broken.
- Normalize shell visual output in the render/export or material mapping path rather than hiding shell internals in tests. The viewport should render the resulting body with stable material assignment while keeping real topology visible. Alternative considered: relaxing visual assertions only, but that would preserve the user-facing flicker.
- Keep e2e assertions lightweight and semantic where possible: session status, diagnostics absence, feature tree/body count, selectable target discovery, and basic canvas stability checks. Pixel assertions should be narrow and used only for the shell flicker regression.

## Risks / Trade-offs

- Feature e2e tests may be slower than current sketch tests -> Keep the harness setup minimal, reuse one chain where it provides meaningful coverage, and avoid broad screenshot baselines.
- Durable topology ids may change after operations -> Resolve targets through picking/search helpers and exposed workbench state instead of hard-coding brittle ids when possible.
- Browser/OCC initialization can add timing sensitivity -> Make harness waits target explicit UI/session states and preview/commit outcomes rather than fixed sleeps.
- Boolean operations can fail for invalid geometry combinations -> Use simple deterministic fixture bodies and explicit boolean scopes that already match lower-level OCC coverage.
