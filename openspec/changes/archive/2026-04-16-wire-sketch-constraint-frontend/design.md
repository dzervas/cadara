## Context

The repository already has three important pieces in place:

- a strongly typed toolbar/source-of-truth model under `src/domain/tools`
- a sketch-tool authoring pattern that keeps interaction logic out of presentational components
- a sketch-only constraint solver spec that keeps solve math out of frontend code

What is missing is the frontend contract that connects them. Sketch constraints are not just passive solved records. They are authoring workflows with staged target selection, operation-specific cursors, live preview graphics, optional numeric entry, and durable viewport annotations that must remain tied to document-owned constraint IDs after commit.

This change should not fold solver concerns into React components or make the viewport the source of truth for constraints. The durable sketch document remains authoritative for committed constraints and dimensions. The frontend editor layer owns only the transient authoring state required to create or edit those durable records.

## Goals / Non-Goals

**Goals:**
- Define the frontend lifecycle for constraint creation, preview, commit, selection, and deletion.
- Add the required sketch constraint tools and button affordances through the existing tool-definition system.
- Keep committed constraint data durable in the sketch document and render committed viewport annotations from document-backed IDs.
- Let constraint tools declare guided selection steps, cursor variants, preview annotations, and floating value input through generic contracts.
- Preserve the split between frontend interaction state, solver math, and durable modeling mutations.

**Non-Goals:**
- Re-specify the underlying solver math or constraint evaluation behavior.
- Move committed constraint ownership into the viewport layer or React component state.
- Put kernel-specific rendering or modeling logic into tool definitions or presentational components.
- Fully redesign every sketch tool; the focus is constraint and dimension authoring flows that build on the current sketch runtime.

## Decisions

### Introduce a dedicated sketch-constraint authoring contract
Constraint authoring should be specified as its own frontend capability rather than implied by the generic drawing-tool contract. Drawing tools create geometry through pointer construction, while constraint tools consume existing sketch entities or points, build an operation intent, and then optionally collect an authored value before commit.

The new contract should define:
- required target kinds for each operation
- ordered selection steps
- cursor/hover guidance during target picking
- transient viewport preview descriptors
- optional floating input prompts for dimensions or angle-like authored values
- the commit payload shape that mutates the durable sketch definition

This keeps the workflow explicit without forcing the solver spec to become a UI spec.

### Keep toolbar metadata in `src/domain/tools` and authoring behavior in sketch-domain modules
The toolbar should continue to source IDs, icons, groups, mode availability, and dropdown family metadata from `src/domain/tools`. Constraint buttons belong there alongside other sketch tools. Their behavior should resolve into constraint authoring definitions in a separate sketch-domain registry or tool family, keeping presentational components unaware of constraint-specific business rules.

This follows the existing split used elsewhere in the workbench: metadata lives in the tool definition layer, interaction state lives in the editor/sketch runtime, and durable mutations cross the modeling boundary.

### Model constraint authoring as staged editor state plus durable document mutations
During authoring, the frontend needs transient state such as:
- which constraint operation is active
- which required targets have been selected
- which target the pointer is currently hovering
- whether a value-entry prompt is open
- what preview annotation(s) should be drawn

That state should live in the editor/sketch session layer. When the operation is valid and committed, the runtime should emit a durable sketch mutation through the modeling service boundary. The committed sketch document becomes the source of truth for later rendering, hit-testing, selection, and deletion.

This avoids a common failure mode where preview graphics become indistinguishable from committed authored state.

### Render transient and committed constraint annotations through separate generic descriptor pipelines
The viewport needs to show two classes of constraint visuals:

- transient previews for the active authoring flow
- committed annotations driven by the authoritative sketch document and solved geometry

Both should be rendered through generic viewport descriptor pipelines, but they should come from different owners. The sketch session provides transient preview descriptors. The durable sketch/solver/modeling side provides committed annotation descriptors keyed by durable constraint or dimension IDs. The renderer should not infer business logic from raw constraint types inside React components.

This split keeps rendering generic while preserving correct ownership semantics.

### Extend the sketch tool/editor schema with cursor, anchored annotation, and floating-input vocabulary
The current schema covers prompts, controls, and a small overlay vocabulary. Constraint authoring requires more:
- cursor variants or declarative cursor hints for target-picking modes
- selection-step guidance tied to required entity kinds
- anchored annotation descriptors suitable for viewport-rendered constraint glyphs
- floating value-entry descriptors that can appear near the pointer or anchored geometry
- interaction affordances for committed annotation selection

These additions should remain declarative. The UI renders them and dispatches actions; it does not decide what a parallel or equal-length constraint means.

### Keep solver and modeling separation explicit
The solver remains responsible for validating and solving authored constraints. The frontend should not compute authoritative constraint satisfaction or geometry placement beyond transient presentation helpers. Durable create/update/delete operations must route through the modeling service boundary, which in turn uses the solver boundary as needed.

This ensures the frontend wiring change does not collapse the solver spec into UI logic.

## Risks / Trade-offs

- [Constraint tools may blur together with drawing tools and overload the current sketch-tool abstractions] -> Mitigate by defining a dedicated constraint-authoring contract that can coexist with, but not distort, the drawing-tool contract.
- [Viewport glyph rendering may accidentally become the authoritative storage for committed constraints] -> Mitigate by requiring durable IDs and document-backed annotation descriptors for all committed visuals.
- [Floating value entry could encourage React-local state that bypasses sketch-session orchestration] -> Mitigate by keeping pending input state in the sketch/editor runtime and exposing only declarative input descriptors to the UI layer.
- [Selection and deletion of committed annotations may become solver-coupled] -> Mitigate by mapping hit-tested annotations back to durable sketch IDs and routing delete actions through the existing modeling/editor command flow.

## Migration Plan

1. Define the sketch-constraint authoring capability and the schema additions needed for cursor, preview, and floating input behavior.
2. Add the required constraint tool definitions and integrate them into the sketch-mode toolbar.
3. Extend sketch-session/controller state so constraint operations can collect targets, drive previews, and request value entry without mixing logic into presentational components.
4. Add durable sketch mutation flow for constraint create/update/delete through the modeling boundary.
5. Add viewport rendering and hit-target support for both transient previews and committed document-backed constraint annotations.
6. Verify that constraint rendering, selection, and deletion continue to use the documented frontend/modeling/solver boundaries.

## Open Questions

- Whether dimensional constraints and non-dimensional geometric constraints should share one toolbar family or use separate grouped tools with distinct cursor affordances.
- Whether committed constraint annotations should be anchored purely from solved geometry or also retain authored placement hints for better readability.
- Whether editing an existing dimension value should reuse the same floating input contract as creation or require a distinct inline-edit lifecycle.
