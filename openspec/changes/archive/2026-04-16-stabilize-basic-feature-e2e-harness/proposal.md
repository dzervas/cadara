## Why

Core feature flows beyond extrude are currently brittle in the workbench: revolve, plane, and boolean operations error, fillet cannot start because edges are not selectable, and shell renders visually unstable interior colors. These are user-visible CAD regressions and need Playwright coverage so future feature-chain work catches the same class of breakage.

## What Changes

- Fix workbench-driven `revolve`, `fillet`, `shell`, `plane`, and boolean feature flows so valid inputs can be selected, previewed, and committed without runtime errors.
- Preserve the existing successful extrude behavior and keep or extend its current e2e coverage.
- Make edges selectable through the feature authoring and viewport selection path so fillet can target durable edges.
- Reduce shell interior flicker/excess coloring by normalizing render output/material behavior for the resulting body.
- Add a small, light Playwright feature-test harness that can create reusable feature fixtures and execute single-feature and multi-feature chains.
- Add e2e tests for extrude, revolve, fillet, shell, plane, and boolean feature flows using the harness.

## Capabilities

### New Capabilities
- `feature-flow-e2e-harness`: Playwright helpers and coverage for stable workbench feature-flow testing, including multi-feature chains.

### Modified Capabilities

## Impact

- Affected code: Playwright tests under `e2e/`, feature-testing helpers, feature authoring definitions under `src/domain/feature-authoring/`, viewport picking/rendering helpers under `src/domain/workspace/` and `src/components/cad/`, and OCC/modeling feature adapters under `src/domain/modeling/`.
- Affected behavior: feature session selection, preview and commit paths, durable edge/face/body reference picking, shell render material stability, and boolean feature validation/diagnostics.
- Dependencies: no new external dependency is expected; the harness should use the existing Vite/Bun/Playwright setup.
