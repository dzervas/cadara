## Why

Sketch-local history currently derives rows from flat sketch entities, constraints, and dimensions. That makes user intent hard to preserve for complex authoring actions such as rectangles, slots, inferred snap constraints, and delete operations, and it risks pushing complex-operation semantics into the sketch solver.

This change adds durable sketch authoring operation metadata so the UI can show one row per accepted user intent while the solver and document graph continue to consume only the current flat sketch definition.

## What Changes

- Add durable sketch authoring operation metadata alongside the authored sketch graph.
- Represent one accepted user intent as one operation row, including constructor actions such as Rectangle and Line, inferred constraints created by that action, manual constraint/dimension creation, direct operation edits, and geometry or annotation deletion.
- Keep complex operations as metadata only; the live sketch graph remains flat points, entities, constraints, dimensions, references, styles, and derivations.
- Remove deleted geometry, constraints, and dimensions from the current live sketch graph while retaining prior operation records needed for rollback and reopened sketch history.
- Allow explicit operation edits, such as changing a rectangle's width dimension through the operation editor, to mutate the relevant original operation record instead of appending an unrelated delete/add pair.
- Update sketch-local history display to show durable operation rows only.
- Keep the sketch solver, region extraction, and render display paths driven by the active flat sketch definition and unaffected by operation metadata.

## Capabilities

### New Capabilities
- `sketch-authoring-operations`: Durable sketch-local operation metadata that records user intent while keeping solver input as the flat sketch graph.

### Modified Capabilities
- `sketch-history-navigation`: Active sketch history displays durable authoring operation rows and moves the sketch cursor by operation boundaries.

## Impact

- Affected contracts: sketch definition schema/runtime schema, commit sketch payload validation, operation history persistence, and reopened sketch session hydration.
- Affected domain code: sketch session history helpers, sketch tool commit paths, constraint authoring, annotation deletion, geometry deletion, direct edit/operator commits, and history cursor filtering.
- Affected UI: sketch-local history rows in the history area.
- Tests will need coverage for durable operation metadata, operation-row history display, deletion as an additional operation, explicit operation edits, save/reopen persistence, and solver isolation from operation metadata.
