## Context

Sketch sessions already own local authored geometry, constraints, dimensions, selection, and sketch-local history through `SketchSessionState`. Delete/Backspace currently resolves to `editor.deleteSelection`, but the enabled path is limited to selected committed constraint or dimension annotations and dispatches `sketch.annotationDeleteRequested`.

Selected sketch geometry is represented as sketch point or sketch entity primitive refs. Deleting those records must also remove constraints and dimensions that reference them so the solver and persisted sketch definition never see dangling local references.

## Goals / Non-Goals

**Goals:**
- Let Delete and Backspace remove selected editable sketch points or entities while a sketch session is active.
- Remove dependent constraint and dimension records in the same sketch mutation.
- Preserve unrelated geometry, constraints, dimensions, references, and document-level history.
- Make toolbar Undo in sketch mode restore the deleted geometry and dependent constraints by moving the sketch-local history cursor.
- Add focused tests for keyboard deletion, dependency cleanup, and undo restoration.

**Non-Goals:**
- Adding a new toolbar delete tool or context menu command.
- Deleting projected reference geometry through the local sketch geometry path.
- Changing solver behavior to tolerate dangling references.
- Changing document-level undo semantics outside an active sketch session.

## Decisions

- Keep the shortcut command as `editor.deleteSelection`.
  - Rationale: Delete and Backspace already map to this command, and the workbench should not need separate commands for annotations versus geometry.
  - Alternative considered: introduce a new `editor.deleteSketchGeometry` command. That would duplicate shortcut bindings and make selection-sensitive routing harder to keep consistent.

- Route sketch delete requests through the editor state machine into sketch-session domain functions.
  - Rationale: Selection interpretation belongs in editor state, while mutation of `SketchDefinition`, `fullDefinition`, `historyCursor`, draft entities, and `commitRequest` belongs in sketch-session domain logic.
  - Alternative considered: delete records directly inside React/workbench code. That would mix presentational and domain concerns and bypass existing history helpers.

- Append deletion as a sketch-local history item by producing a new tail definition from the cursor-truncated full definition.
  - Rationale: Existing sketch undo/redo works by moving `historyCursor`; using the same shape lets toolbar Undo restore geometry and constraints without a parallel inverse stack.
  - Alternative considered: store an explicit inverse command for deletion. That would duplicate sketch history state and create conflict cases with cursor-based redo.

- Remove all constraints and dimensions that reference deleted local geometry before solving or rebuilding visible session state.
  - Rationale: Dependent records become invalid as soon as their target geometry is removed, and preserving unrelated records keeps the operation surgical.
  - Alternative considered: block deletion when constraints exist. That is less useful for sketch editing and does not match the requested behavior.

## Risks / Trade-offs

- Shared points may be referenced by multiple entities → deletion rules must be explicit about deleting only selected records and cascading records that directly reference removed point or entity IDs.
- Constraint and dimension schemas reference geometry in several shapes → implement shared reference-detection helpers and cover representative point/entity constraint cases in tests.
- Delete/Backspace may be pressed while an annotation value input is focused → preserve existing input-local Backspace behavior and only route workbench shortcuts when the command provider receives the key event.
- Selection can include non-editable targets → keep the local sketch geometry delete path restricted to editable sketch point/entity selections and leave unrelated targets unchanged.
