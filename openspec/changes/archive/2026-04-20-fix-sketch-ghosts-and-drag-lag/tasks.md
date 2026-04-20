## 1. Sketch Session State

- [x] 1.1 Replace `SketchSessionState.entities` with `toolStagedEntities: readonly SketchDraftEntity[]` in `src/domain/editor/sketch-session.ts`.
- [x] 1.2 Add `deriveSketchDisplayEntities(session)` to derive accepted display entities from `session.definition.entities` and append staged tool entities.
- [x] 1.3 Update accepted-only session transitions to clear `toolStagedEntities`.
- [x] 1.4 Update preview/staged session transitions to store only transient tool geometry in `toolStagedEntities`.
- [x] 1.5 Update `getSketchSessionDisplayRenderables()` to render `deriveSketchDisplayEntities(session)` instead of a mutable session entity mirror.

## 2. Tests For Derived Display Entities

- [x] 2.1 Update sketch editing tests that read or construct `session.entities` to use `toolStagedEntities` or `deriveSketchDisplayEntities(session)`.
- [x] 2.2 Update sketch snapping and sketch tool registry tests that read display entities to use `deriveSketchDisplayEntities(session)`.
- [x] 2.3 Add or update coverage proving edited or deleted accepted geometry is not rendered from stale session state.
- [x] 2.4 Add or update coverage proving staged tool geometry appears only while explicitly staged.

## 3. Drag Scheduling

- [x] 3.1 Add viewport refs for the latest pending drag point and pending drag animation-frame id.
- [x] 3.2 Replace direct drag move execution in `handlePointerMove` with `requestAnimationFrame` batching that processes the latest projected sketch point once per frame.
- [x] 3.3 Cancel pending drag animation frames on drag end and viewport component cleanup.
- [x] 3.4 Add or update coverage for coalesced drag moves and pending-frame cancellation where practical with the existing test harness.

## 4. Viewport Render And BVH Stability

- [x] 4.1 Update the sketch renderable portion of `bvhSceneKey` to use structural identity and geometry kind instead of positional geometry tokens.
- [x] 4.2 Refactor `SketchDisplayPolylineNode` so line, material, and buffer geometry creation are keyed by structural inputs, with coordinate updates applied in place.
- [x] 4.3 Refactor `SketchDisplayMarkerNode` so positional changes update marker position without recreating materials for unchanged structural styling.
- [x] 4.4 Add or update coverage, assertions, or focused regression checks for positional-only sketch updates preserving BVH structural keys.

## 5. Verification

- [x] 5.1 Run `bun run test`.
- [x] 5.2 Run `bun run lint`.
- [x] 5.3 Run `bun run build`.
