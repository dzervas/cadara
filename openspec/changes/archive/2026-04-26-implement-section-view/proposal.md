## Why

The `Section View` toolbar button exists, but it does not open the CAD-style inspection workflow users expect. Users need a temporary sectioning mode that starts from an explicit planar seed, lets them drag the cut depth in the viewport, and renders a readable mechanical-drawing section without changing the underlying model.

## What Changes

- Add a temporary part-mode `Section View` workflow that begins by collecting one planar seed from a planar face, closed profile region, construction plane, or plane feature.
- After a valid seed is chosen, show a viewport drag handle on the section normal so the user can move the cut plane back and forth through the currently visible model.
- Default the initial kept side to the side away from the current camera so the exposed cut is visible immediately.
- Let the user flip which half is retained after activation without requiring reselection of the seed.
- Clip the whole visible model against the active section plane without mutating durable geometry, feature definitions, or document state.
- Render newly exposed cut faces with a solid flat section treatment and diagonal hatch lines, while leaving uncut visible surfaces on the retained half with their existing shading treatment.
- Add focused tests covering tool activation, accepted seed types, handle dragging, side flipping, clipping scope, and section rendering behavior.

## Capabilities

### New Capabilities

- `section-view-inspection`: Defines the temporary section-view workflow, accepted planar seeds, viewport drag/flip controls, model clipping scope, and cut-surface rendering treatment.

### Modified Capabilities

- `editor-runtime-orchestration`: The editor runtime must support a temporary inspect-style command workflow for section view activation, seed collection, dragging, flipping, and cancellation.
- `viewport-runtime-parity`: The viewport must support section-plane overlays, pointer-driven handle dragging, and temporary clipping of visible renderables without mutating authored geometry.

## Impact

- Affected areas include toolbar action wiring in [`src/app/cad-workbench.tsx`](/app/src/app/cad-workbench.tsx), editor/runtime state in [`src/contracts/editor/state-machine.ts`](/app/src/contracts/editor/state-machine.ts), viewport interaction/rendering in [`src/components/cad/three-cad-viewport.tsx`](/app/src/components/cad/three-cad-viewport.tsx), renderable composition under [`src/app/viewport-renderables.ts`](/app/src/app/viewport-renderables.ts), and picking/selection helpers under `src/domain/workspace/`.
- The change should remain frontend- and viewport-owned. It should not require a new durable modeling feature or any document/schema migration because section view is a temporary inspection effect.
- Rendering will likely need a small section-specific material/overlay path for flat cut faces and diagonal hatch lines while preserving existing shading on uncut surfaces.
