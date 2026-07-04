## Why

Sketch dimensions currently accept only concrete numbers. The viewport floating input renders numeric-only controls, the sketch-tool presentation schema carries only `number | null`, durable `DimensionDefinition` records store `value: number` or `valueRadians: number`, normalization rejects non-numeric payloads, and the sketch solver consumes those fields directly.

That prevents users from driving sketch dimensions from document variables even though document variables and feature value expressions already preserve raw expression text and resolve against current variable values at runtime. A UI-only change would be lossy: entering `width + 5` could only be resolved immediately to a number and the authored expression would be lost on edit, replay, and variable changes.

## What Changes

- Extend authored sketch dimension values so driving dimension magnitudes can preserve either literal numeric values or raw expression text.
- Reuse the existing authored-value and document-variable expression concepts instead of adding a sketch-specific expression language.
- Resolve expression-authored sketch dimensions to concrete finite numeric values before sketch solver execution.
- Preserve raw expression text through dimension authoring, committed annotation editing, history replay, save/restore, and rebuild.
- Surface diagnostics when a sketch dimension expression cannot resolve or fails dimension-specific value validation, without silently rewriting or dropping the authored expression.
- Keep target selection, annotation placement, durable sketch records, expression resolution, and solver execution in their existing architectural layers.

## Capabilities

### New Capabilities

### Modified Capabilities

- `sketch-constraint-authoring`: Sketch dimension value entry accepts expression-capable authored values while preserving existing target-selection, annotation placement, and solver-boundary separation.
- `feature-value-expressions`: The shared expression resolution model extends from feature editor values to eligible sketch dimension magnitudes, with the same raw-expression persistence and current-document-variable resolution semantics.
- `durable-modeling-contract`: Durable sketch dimension definitions persist authored value wrappers for eligible driving magnitudes, and modeling execution resolves them before invoking the sketch solver.

## Impact

- Affected contracts: `DimensionDefinition` value fields, sketch definition normalization, runtime validation, history persistence, and legacy literal normalization.
- Affected editor/domain code: sketch constraint authoring state, floating input descriptors, annotation edit state, dimension label formatting, validation feedback, and commit/update paths.
- Affected modeling/solver boundary: introduce a resolved sketch definition path before `solveSketchDefinitionCore` / solver adapter calls so solver code continues to consume concrete numbers.
- Affected UI: viewport floating inputs must accept text for expression-capable dimension values while still supporting numeric literals, min validation, cancel, and commit behavior.
- Affected tests: focused `bun:test` coverage for authoring, editing, persistence/replay, resolver diagnostics, variable changes, and solver-boundary concrete values.
- No new expression parser dependency is expected; reuse the existing math.js-backed document-variable expression infrastructure.
