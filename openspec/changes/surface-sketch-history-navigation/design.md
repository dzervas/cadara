## Context

The current modeling snapshot already carries durable sketch records and sketch targets, and both mock and OCC snapshot builders can emit sketch rows in feature-tree-style presentation data. The left `Parts & Objects` section is narrower: its object row contract only covers bodies and constructions, so committed sketches are not available there for visibility management. The bottom `FeatureTimelineBar` is also feature-only because it renders `document.features` and uses `DocumentFeatureCursor`.

Sketch edit sessions hydrate from committed sketches, but active sketch authoring state is not modeled as a visible local timeline. That makes the document feature timeline remain the only rollback/cursor surface even while the user is editing sketch-local geometry, constraints, and dimensions.

## Goals / Non-Goals

**Goals:**
- Treat committed sketches as first-class navigation rows in `Parts & Objects` and normal document history.
- Extend visibility filtering so hiding a sketch hides all sketch-owned renderables and selection targets without removing navigation rows.
- Introduce a document history presentation model that can render sketches and features in one ordered timeline.
- Introduce a sketch-local history presentation model for active sketch sessions, with cursor movement and after-cursor treatment equivalent to the document history.
- Animate between document history and sketch history on sketch entry and exit using the existing workbench shell/timeline area.

**Non-Goals:**
- Add new sketch tools, constraints, or kernel geometry capabilities.
- Redesign the whole sidebar or replace the dense dark CAD workbench style.
- Add branching history visualization or freeform cursor positions that do not map to valid authored items.
- Persist hidden/visible state across reloads unless the existing visibility state already does so.

## Decisions

### Use explicit history view models instead of overloading feature records

Create UI/domain presentation helpers for ordered history items:
- Document history items represent committed sketches and committed features using durable targets.
- Sketch history items represent authored sketch entities, constraints, and dimensions for the active sketch session.

This is preferable to forcing sketches into `FeatureSnapshotRecord`, because sketches are not solid features and have different edit-session data. It also avoids making React components infer history order by stitching together unrelated arrays.

Alternative considered: keep `FeatureTimelineBar` feature-only and add a separate sketch list. That would not satisfy the requested normal feature history including sketches, and it would duplicate cursor behavior.

### Keep visibility keyed by durable targets

Continue using `getPrimitiveRefKey` and `hiddenTargetKeys`, but include sketch targets in the valid visibility key set and make viewport composition filter all sketch-owned renderables and selection targets when a sketch target is hidden.

This keeps the state local and small, matching the current body/construction visibility pattern. It also avoids adding persisted visibility data to the modeling contract before persistence is requested.

Alternative considered: add visibility to document snapshots. That would couple UI-only display state to kernel snapshots and require migration semantics for no modeling benefit.

### Model sketch history cursor separately from document cursor

Add a sketch-session cursor over sketch-local history items rather than reusing `DocumentFeatureCursor`. The document cursor applies to committed document history; the sketch cursor applies to the draft sketch definition while the session is active.

This keeps sketch rollback/replay inside the sketch editor, where insert-after-cursor behavior can update the draft definition and display renderables before commit. It also avoids broadening document cursor semantics to point at sketch entity IDs.

Alternative considered: make `DocumentFeatureCursor` a universal cursor for features, sketches, and sketch internals. That would be too broad and would leak sketch-edit internals into the modeling document contract.

### Animate the timeline content swap in the shell

The workbench shell should own the transition between normal document history and sketch-local history because it already knows whether `sketchSession` is active and owns the history area composition. The history component can receive the active mode and render both outgoing and incoming item sets during the transition.

This is preferable to scattering transition state across sidebar rows, sketch tools, and modeling services. It keeps animation presentational while history item and cursor behavior remain testable in helper modules.

Alternative considered: conditionally render one timeline or the other without an animation. That would be simpler, but it misses the requested slide-down and slide-up affordance.

## Risks / Trade-offs

- [Risk] Document history order may not currently be explicit enough for sketches and features in all kernel adapters. -> Mitigation: add a presentation-layer document history item order and tests for mock and OCC snapshot builders before changing UI rendering.
- [Risk] Sketch-local rollback can accidentally mutate committed sketch state before commit. -> Mitigation: keep rollback and insert-after-cursor operations in `SketchSessionState` draft data and only call `commitSketch` on explicit sketch commit.
- [Risk] Hidden sketch filtering can leave stale selection or hover targets active. -> Mitigation: clear hover and selection targets whose durable key belongs to a hidden sketch, matching the existing hidden-target behavior.
- [Risk] Animation tests can become brittle if they depend on exact timing. -> Mitigation: test state, class/data attributes, and reduced-motion-friendly behavior rather than wall-clock animation duration.

## Migration Plan

1. Extend presentation contracts and snapshot builders to expose sketch object rows and document history items.
2. Add history helper functions for document history and sketch-local history ordering, cursor indexing, and insert-after-cursor behavior.
3. Update `FeatureSidebar`, the history/timeline component, and workbench shell composition to render sketch rows, visibility state, and animated history swaps.
4. Update viewport renderable composition and selection filtering to respect hidden sketch targets.
5. Add focused `bun:test` coverage for contracts/helpers and React rendering behavior.

Rollback is code-only: remove the new presentation fields/helpers and return the timeline to `document.features` if implementation needs to be backed out before release.

## Open Questions

None for the proposal. The implementation can choose the exact animation duration and easing from existing workbench/Mantine conventions as long as the required slide directions and interaction gating are preserved.
