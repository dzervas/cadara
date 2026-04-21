## Why

The viewport currently starts in perspective projection and has no nearby control for switching between perspective and orthographic views. CAD workflows commonly need orthographic projection as the default for precise spatial inspection, with perspective still available when depth cues are useful.

## What Changes

- Default the workbench viewport camera to orthographic projection.
- Add a compact projection dropdown positioned under and to the right of the view cube overlay.
- Use `public/icons/view-cube.svg` as the dropdown trigger icon.
- Allow users to switch the active viewport camera between `Orthographic` and `Perspective`.
- Preserve existing view cube face/corner snapping, orbit controls, picking, sketch pointer projection, and sketch camera framing behavior across projection changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `viewport-view-cube-navigation`: Add projection selection behavior colocated with the view cube, including orthographic default and user switching between orthographic and perspective camera projections.

## Impact

- Affected code includes `src/components/cad/three-cad-viewport.tsx`, viewport camera/navigation helpers in `src/domain/workspace/`, and focused viewport tests.
- No external API or dependency changes are expected.
- E2E or component coverage may need to verify the default projection, dropdown placement, and switching behavior.
