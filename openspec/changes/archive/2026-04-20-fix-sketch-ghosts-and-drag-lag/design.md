## Context

Sketch editing currently keeps accepted geometry in both `SketchSessionState.definition.entities` and `SketchSessionState.entities`. The second field is manually refreshed across many editor transitions and also stores transient tool preview geometry, so a missed refresh can leave stale accepted renderables in the viewport.

Direct geometry drag updates run through the sketch solver from pointer move handlers. During drag, each solved point update produces new sketch renderable geometry, which changes the BVH scene key and can remount the accelerated picking tree. Sketch display line nodes also recreate Three.js objects on positional updates instead of updating existing buffers.

## Goals / Non-Goals

**Goals:**

- Make accepted sketch display entities a pure derivation of the current sketch definition.
- Keep transient tool preview or staged geometry explicit and separate from accepted definition geometry.
- Reduce drag latency by coalescing pointer moves to one solve per animation frame.
- Prevent positional-only sketch edits from forcing BVH remounts or avoidable Three.js object churn.
- Preserve existing sketch editing behavior, picking targets, styling, and test runner choices.

**Non-Goals:**

- Replace or rewrite the BFGS solver.
- Move solving to a worker thread.
- Redesign sketch entity contracts or authored sketch persistence.
- Change visible CAD styling beyond removing stale or duplicate geometry.

## Decisions

1. Use `definition.entities` as the only accepted-entity source of truth.

   `SketchSessionState.entities` will be replaced by `toolStagedEntities`. A pure helper, `deriveSketchDisplayEntities(session)`, will map accepted entities from `session.definition.entities` and append staged entities when present. This removes manual accepted-entity synchronization while preserving transient tool previews.

   Alternative considered: keep `session.entities` and add stricter sync helpers. That would reduce some call-site duplication but would preserve the duplicated state that caused the ghost geometry failure mode.

2. Coalesce geometry drag moves with `requestAnimationFrame` in the viewport.

   Pointer move handlers will store the latest projected sketch point and schedule one drag update for the next animation frame. Drag end and component cleanup will cancel pending frames so stale drag updates cannot apply after the drag lifecycle ends.

   Alternative considered: throttle inside sketch-session domain code. The domain layer has no frame scheduling context and should remain deterministic and easy to test; the viewport is the correct owner of browser event batching.

3. Treat sketch BVH keys as structural for active sketch renderables.

   Sketch renderable keys used for BVH remount decisions will include stable identity, line pattern, target identity, and geometry kind, but not positional geometry tokens. Target bindings and geometry kind changes still invalidate the acceleration tree, while drag-only coordinate changes update existing scene objects.

   Alternative considered: disable BVH during drag. That would avoid remount churn but would make picking behavior mode-dependent and could regress dense-scene hover and selection.

4. Update display node geometry in place for positional changes.

   `SketchDisplayPolylineNode` will keep its line object, material, and buffer geometry stable across coordinate updates, then refresh vertex positions through the existing geometry buffer. Marker nodes will keep material creation structural and update position props for coordinate movement.

   Alternative considered: keep recreating nodes and rely only on the BVH key fix. That still leaves avoidable Three.js allocation and React object churn during drag.

## Risks / Trade-offs

- Derived display entities may allocate on each renderable query -> Keep the helper pure and local; avoid extra memoization unless profiling shows it is needed.
- Coalesced drag updates can skip intermediate pointer positions -> Always retain the latest projected point so the visible drag follows the final pointer position for each frame.
- Structural BVH keys can keep acceleration state while coordinates move -> In-place geometry updates must update the underlying buffers before the next pick, and structural target changes must still change the key.
- Tests that construct `SketchSessionState` directly will fail after removing `entities` -> Update tests to use `toolStagedEntities` and `deriveSketchDisplayEntities(session)` where display entities are asserted.

## Migration Plan

1. Replace `SketchSessionState.entities` with `toolStagedEntities` and add `deriveSketchDisplayEntities(session)`.
2. Update sketch-session transitions so accepted-only paths clear `toolStagedEntities`, and preview paths store only staged entities.
3. Update renderable generation and tests to use the derived display helper.
4. Add viewport drag rAF batching and cleanup cancellation.
5. Stabilize the sketch BVH key and update sketch display nodes to mutate positional geometry in place.
6. Verify with `bun run test`, `bun run lint`, and `bun run build`.

Rollback is a normal code revert because no persisted document format or external API changes are introduced.

## Open Questions

None.
