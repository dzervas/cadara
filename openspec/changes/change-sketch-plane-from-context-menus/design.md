## Context

Committed sketches currently support two edit-adjacent flows:

- `authoring.reopenRequested` with `toolId: 'sketch'`, which rolls back the document cursor when needed and re-enters full sketch authoring.
- Generic inspector-backed feature editing, which is limited to `editingFeature` state and `FeatureEditSessionState`.

Neither flow covers the requested behavior cleanly. Reopening the sketch editor is the wrong UX for a one-field plane retarget, and forcing sketches into the feature authoring registry would blur a boundary the repo currently keeps explicit. At the same time, the workbench already has the right entry points for the action: sketch rows in `Parts & Objects` and committed sketch items in the bottom history bar both build explicit custom context-menu action lists.

The modeling mutation path is favorable: committed sketch persistence already goes through `commitSketch({ sketchId, sketchLabel, plane, definition })`, so plane reassignment can likely reuse the existing modeling contract without a new backend API.

## Goals / Non-Goals

**Goals:**
- Add `Change Sketch Plane` to committed sketch context menus in `Parts & Objects` and the bottom history bar.
- Open an inspector-backed edit flow that is distinct from normal sketch reopen.
- Let the user retarget a committed sketch to another supported origin datum plane (`XY`, `YZ`, `XZ`).
- Persist the new plane through the existing sketch commit path and rebuild downstream history from the accepted snapshot.
- Preserve the current `Edit` action semantics for sketches.

**Non-Goals:**
- Generalize sketch support editing to arbitrary planar faces or arbitrary construction planes.
- Merge sketch editing into the feature authoring registry.
- Change sketch-local authoring tools, camera-entry behavior, or the standard sketch reopen flow.
- Introduce a new modeling-service mutation if `commitSketch` remains sufficient.

## Decisions

### Use a dedicated sketch-plane edit flow, not the existing sketch `Edit` action

`Edit` already means "reopen the sketch editor and continue authoring." This change adds a second, narrower flow for support-plane reassignment. Keeping those paths separate matches the user request and avoids overloading the existing sketch editor with a modal one-field mutation.

Alternative considered:
- Reuse `Edit` and add a plane control inside sketch mode. Rejected because it mixes history-safe support-plane reassignment with normal sketch authoring and makes a simple action harder to discover.

### Reuse the rollback-aware committed-item lifecycle, but do not pretend the session is a feature

The editor already knows how to roll the document cursor back before editing a committed item and restore it afterward. The new flow should reuse that cursor lifecycle for committed sketches, but it should not be represented as `FeatureEditSessionState` or registered as a fake feature type.

The clean implementation path is a dedicated sketch-plane edit session in the editor runtime, with its own draft type and commit effect, while reusing the same inspector shell and the existing form-rendering primitives.

Alternatives considered:
- Route the flow through `authoring.reopenRequested` with a synthetic tool ID. Rejected because that event currently encodes either full sketch reopen or committed feature hydration.
- Represent sketch plane reassignment as a feature edit session. Rejected because sketches are not authored features and the feature registry should not become a catch-all editor abstraction.

### Reuse the existing inspector form vocabulary with an enum-backed origin-plane field

The current form schema already supports enum fields, summaries, diagnostics, and generic patch binding. For this scope, the plane selector should be an enum over the supported origin plane keys rather than a viewport reference picker.

That keeps the change small, avoids new form-schema vocabulary, and matches the explicit assumption that this capability targets origin datum planes only.

Alternative considered:
- Use a reference picker against construction targets. Rejected for this proposal because it broadens the behavior toward arbitrary construction selection and invites viewport-selection complexity that the user did not ask for.

### Persist by recommitting the sketch with its existing definition and a new plane

The commit payload for sketches already contains the durable label, the full `SketchPlaneDefinition`, and the authored sketch definition. Plane reassignment should reuse that path by:

- hydrating the committed sketch snapshot,
- replacing only the plane payload,
- recommitting through `commitSketch`,
- accepting the refreshed snapshot and existing rebuild diagnostics behavior.

This keeps the modeling boundary unchanged and makes downstream feature rebuild fallout visible through the same diagnostics pipeline already used for other committed edits.

Alternative considered:
- Add a dedicated `updateSketchPlane` mutation. Rejected unless implementation discovery proves `commitSketch` cannot safely cover the change.

### Limit the first version to origin-backed sketch reassignment

The action should be shown only when the committed sketch participates in the new reassignment capability. For the first version, that means sketches whose current plane support can be resolved to a supported origin datum plane, and the destination options are the other supported origin datum planes in the current snapshot.

This keeps the data contract simple and avoids underspecified behavior for face-backed sketches, consumed sketch planes, or custom construction planes.

Alternative considered:
- Show the action for every sketch and allow arbitrary planar retargeting. Rejected as too ambiguous for a first pass and likely to require new reference-picking, validation, and migration behavior.

## Risks / Trade-offs

- [Inspector state is feature-only today] → Extract the reusable inspector panel/form rendering from `FeatureInspector` and introduce a sketch-plane-specific session adapter instead of widening everything to `any`.
- [Downstream features may fail after a plane change] → Let the recommit rebuild through the normal diagnostics path and preserve the existing rollback/restore lifecycle so the user can repair or undo from a coherent document state.
- [Origin-plane availability depends on snapshot constructions] → Derive selectable plane options from the authoritative datum constructions in the active snapshot and disable or omit the action when the sketch cannot participate safely.
- [The action now differs between sketch and feature history items] → Keep the item-kind branching in the menu helper minimal and explicit: features retain existing actions, eligible sketches gain one additional action.

## Migration Plan

1. Extend the sketch row and history-item context-menu builders to surface `Change Sketch Plane` for eligible committed sketches.
2. Add editor-runtime events, state, and effects for sketch-plane edit entry, patching, commit, cancel, and rollback-aware restore.
3. Extract or generalize the inspector shell just enough to render the sketch-plane session through the existing form controls.
4. Recommit sketches with updated plane payloads through `commitSketch`, then refresh the accepted snapshot and diagnostics.
5. Add or update tests at the appropriate UI/logic lanes when implementation begins.

No persisted-data migration is required because the change reuses the existing committed sketch schema.

## Open Questions

- Should the first version omit the action entirely for non-origin-backed sketches, or show it disabled with an explanatory label?
- If a sketch contains plane-sensitive imported assets such as reference images, is preserving the same local sketch coordinates sufficient, or do any imported payloads need explicit validation before commit?
