## Context

Active sketches currently store the authored graph as flat points, entities, constraints, dimensions, references, styles, and derivations. Sketch-local history is derived from those flat records, with undo/redo grouping mostly inferred from shared sequence numbers in generated ids. That works for basic grouping, but it does not durably preserve the user's accepted authoring intent as a first-class history row.

The desired behavior is closer to feature history: a rectangle appears as one authored operation even though the live sketch graph contains four line entities plus constraints and dimensions. Later deletions or edits are additional operations unless the user explicitly edits the original operation.

The sketch solver has a separate hard constraint: it must continue to return results fast enough for interactive editing and direct drag updates. Operation metadata must therefore stay outside the solver's input model.

## Goals / Non-Goals

**Goals:**
- Persist sketch-local operation metadata durably with the authored sketch definition.
- Show operation rows only while editing a sketch.
- Keep the live sketch graph flat and authoritative for solver, region extraction, rendering, picking, and commit payloads.
- Record deletions as additional operations while removing deleted targets from the live graph.
- Support explicit operation edits that update the original operation metadata and the corresponding live graph members.
- Preserve inferred constraints under the operation that accepted the snap or constructor intent.

**Non-Goals:**
- Do not add complex geometry primitives to the solver.
- Do not derive rectangles, slots, polygons, or other complex operations by inspecting flat geometry.
- Do not automatically compact, squash, or remove old operations whose outputs were later deleted.
- Do not add expandable child rows to the sketch history UI in this change.

## Decisions

1. Store durable `authoringOperations` metadata alongside the flat sketch graph.

   `SketchDefinition` should gain an optional ordered operation metadata collection. Each operation should carry a durable operation id, display label, operation kind, and structured target refs for graph members it created, removed, replaced, or edited. The exact union can evolve by operation type, but the first contract should be explicit enough for constructor, constraint/dimension authoring, delete, and operation-edit rows.

   Alternative considered: keep sketch history as inferred rows from flat ids. That preserves current simplicity, but it cannot durably display accepted user intent after save/reopen and it encourages fragile parsing of generated ids.

2. Keep the flat sketch graph as the current document state.

   Deleting geometry, constraints, or dimensions removes those records from `points`, `entities`, `constraints`, `dimensions`, and their id arrays. Prior operation metadata may still reference those removed ids so rollback and reopened sketch history can explain what happened, but those references are historical metadata rather than live document graph members.

   Alternative considered: mark deleted members as hidden/tombstoned inside the graph. That would make solve/render filters more complicated and would risk stale deleted members leaking into current document behavior.

3. Treat ordinary deletion and replacement as append-only operations, but allow explicit operation edits to mutate the source operation.

   A direct Delete on a rectangle edge appends `Delete Geometry` and removes the edge plus dependent constraints/dimensions from the live graph. Editing a rectangle width through the operation or dimension edit path updates the original rectangle operation and live graph values instead of appending a delete/add sequence.

   Alternative considered: decompose or remove earlier complex operation rows when all their outputs are deleted. That makes current history look cleaner, but it destroys durable rollback explanation and is not needed without a compaction feature.

4. The solver ignores operation metadata.

   Solving, dragged-handle solving, region extraction, and display derivation should receive only the filtered flat sketch definition for the current cursor. Operation metadata should never add constraints, expand geometry, or change solved output.

   Alternative considered: have the solver or a solve pre-pass expand complex operations. That would turn history metadata into geometry semantics and complicate every-frame solving.

5. Legacy sketches without operation metadata use a simple flat fallback.

   Existing documents may not have `authoringOperations`. Reopen and history display should tolerate the missing field by showing simple rows from existing flat records or a compatibility representation. The fallback must not attempt to recognize complex geometry such as rectangles from graph topology.

   Alternative considered: migrate legacy flat sketches into complex operation metadata by pattern matching. That violates the no-derivation rule and risks inventing false authoring intent.

## Risks / Trade-offs

- [Historical refs can point at deleted graph members] -> Keep historical references scoped to operation metadata and ensure solver/render/current selection paths use only the filtered live graph.
- [Operation edits can drift from graph members] -> Update operation metadata and graph records through one domain function per editable operation type, with tests covering both outputs.
- [Undo/redo semantics become split between current graph and operation metadata] -> Make cursor filtering operate on operation boundaries and rebuild a flat graph for the active cursor before solving.
- [Runtime schema changes can break old documents] -> Make the new field optional initially and normalize missing metadata to a compatibility fallback during session hydration.
- [Metadata grows over time] -> Accept append-only growth for now; compaction is intentionally out of scope.

## Migration Plan

1. Extend sketch contract and runtime parsing to accept optional durable authoring operation metadata.
2. Normalize missing metadata on load to a compatibility sketch history representation without complex-geometry inference.
3. Update new sketch authoring paths to write metadata for new operations.
4. Update sketch-local history UI and cursor helpers to prefer operation metadata and fall back only for legacy sketches.
5. Keep persisted operation history replay compatible by preserving the new sketch metadata in commit sketch entries.
