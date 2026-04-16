## Why

The new sketch constraint solver spec defines how authored constraints are represented and solved, but the frontend still lacks the authoring and rendering flow needed to use that capability. Constraint operations need to be first-class sketch actions with dedicated toolbar buttons, staged pointer-driven creation, live viewport previews, value entry for dimensional constraints, and durable document-backed annotations that remain visible and selectable after commit.

Without a dedicated frontend contract, constraint creation risks being split across ad hoc UI code, solver-specific behavior, and viewport-only rendering. That would violate the current architecture goals around keeping tool definitions, frontend/editor state, and durable modeling boundaries cleanly separated.

## What Changes

- Add a frontend sketch-constraint authoring capability that defines how constraint tools are exposed, staged, previewed, committed, rendered, selected, and deleted.
- Extend the sketch tool/editor presentation contract so active constraint tools can declare custom cursor state, selection guidance, viewport annotation previews, and floating value-entry prompts without embedding business logic in React components.
- Require committed constraint and dimension operations to be written into the durable sketch document through the modeling boundary rather than living only in transient viewport state.
- Require the viewport layer to render both transient constraint previews and committed document-backed constraint annotations from generic descriptors keyed by durable sketch IDs.
- Add toolbar coverage for the required sketch constraint tools while preserving the existing source-of-truth split between tool metadata, editor interaction state, and solver/modeling implementations.

## Capabilities

### New Capabilities
- `sketch-constraint-authoring`: Defines the frontend authoring lifecycle for sketch constraints and dimensions, including toolbar exposure, guided entity selection, custom cursor/preview behavior, floating numeric entry, durable document updates, viewport annotations, and annotation selection/deletion behavior.

### Modified Capabilities
- `sketch-tool-editor-schema`: Constraint tools need richer generic presentation descriptors for cursor state, selection affordances, anchored preview annotations, and floating value-entry surfaces.
- `frontend-modeling-boundary`: Constraint create/update/delete flows must remain durable modeling actions routed through the frontend-facing modeling service and solver boundary instead of being applied directly in UI code.

## Impact

- Affected areas include `src/domain/tools`, sketch-session/controller state, sketch tool or constraint authoring registries, viewport annotation rendering, overlay/input presentation, and modeling-service sketch mutation flows.
- Introduces a frontend contract for durable constraint annotations keyed to sketch constraint and dimension IDs.
- Preserves the split between solver-owned constraint math, frontend-owned interaction state, and modeling-owned durable document mutations.
