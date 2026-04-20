## Why

Active sketch editing can leave stale geometry visible because accepted sketch entities are stored in two places and manually synchronized across session transitions. Direct drag interactions also feel laggy because every pointer move can run the constraint solver synchronously and positional-only updates currently force expensive viewport remount and BVH rebuild work.

## What Changes

- Replace the mutable `SketchSessionState.entities` mirror with a derived accepted-entity view plus an explicit `toolStagedEntities` field for transient tool previews.
- Render active sketch display entities from the current sketch definition and current staged tool entities only, eliminating stale accepted geometry after edits.
- Batch sketch geometry drag updates with `requestAnimationFrame` so the solver runs at most once per frame and always consumes the latest projected drag point.
- Keep viewport pick acceleration structurally stable while sketch point positions change by excluding positional sketch geometry tokens from the BVH scene key.
- Update sketch display nodes so line geometry buffers and marker positions update in place instead of recreating Three.js objects for every drag position.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sketch-geometry-editing`: Active sketch editing must display geometry from the current sketch definition without stale accepted entities, and direct drag updates must apply the latest pointer position through coalesced per-frame interaction updates.
- `viewport-picking-acceleration`: BVH-backed picking must preserve stable target bindings without rebuilding acceleration state for sketch positional-only updates.
- `viewport-authoring-feedback`: Active sketch authoring feedback must keep transient staged geometry distinct from accepted sketch definition geometry and remove stale transient renderables when tools finish, cancel, or change.

## Impact

- Affected domain code: `src/domain/editor/sketch-session.ts`.
- Affected viewport code: `src/components/cad/three-cad-viewport.tsx`.
- Affected tests: sketch session/editing/snapping/tool registry specs that read `session.entities`, plus any viewport behavior tests that cover drag scheduling or renderable identity.
- No new runtime dependencies or external APIs are required.
