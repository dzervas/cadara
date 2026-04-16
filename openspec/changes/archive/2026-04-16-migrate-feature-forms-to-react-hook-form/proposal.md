## Why

Feature-session forms are currently rendered from a custom schema and push opaque patch objects directly into the editor state machine on every control change. That keeps the modeling boundary intact, but it leaves React responsible for low-level field plumbing, custom value coercion, and reset behavior that a form library already solves better, while sketch authoring uses a completely separate UI path that should not be mixed into this migration.

## What Changes

- Introduce `react-hook-form` for feature-session form state in the generic `FeatureInspector`.
- Add a feature-form adapter layer that maps the existing declarative feature form schema into `react-hook-form` field registration, validation, reset, and submission semantics.
- Preserve the current editor-machine responsibilities for preview, commit, cancel, and viewport/sidebar reference picking instead of moving those workflows into React components.
- Replace direct input-to-patch dispatch for numeric and enum controls with a form-driven synchronization path that emits validated draft patches back to the editor runtime.
- Keep reference-picker and reference-collection fields integrated with the existing selection filter and active-picker flow, but bridge their selected values through `react-hook-form` so feature forms have one local source of truth.
- Exclude sketch tool panels, sketch floating inputs, sketch constraints, and any sketch-only authoring controls from the migration scope.

## Capabilities

### New Capabilities
- `feature-form-react-hook-form`: Defines the feature-session form runtime that uses `react-hook-form` for local feature form state while preserving the existing feature authoring, preview, commit, and reference-picking workflow boundaries.

### Modified Capabilities

## Impact

- Affected code includes `src/components/layout/feature-inspector.tsx`, `src/domain/feature-authoring/form-schema.ts`, `src/domain/feature-authoring/form-events.ts`, `src/domain/editor/feature-editing.ts`, `src/contracts/editor/state-machine.ts`, feature authoring definitions under `src/domain/feature-authoring/features/`, and their related tests.
- Adds a new runtime dependency on `react-hook-form`.
- Leaves sketch authoring surfaces under `src/components/cad/` and `src/domain/sketch-tools/` out of scope.
