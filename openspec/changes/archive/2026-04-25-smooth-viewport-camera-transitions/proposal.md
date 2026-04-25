## Why

Programmatic viewport camera jumps currently snap immediately, which makes view-cube navigation and sketch entry feel abrupt and makes it harder to keep spatial context. Sketch editing also reframes the camera to the sketch plane without restoring the prior workbench view on exit, forcing users to manually recover their previous position after leaving the sketch.

## What Changes

- Animate programmatic viewport camera moves so view-cube navigation and sketch framing transition smoothly instead of snapping.
- Capture the pre-sketch viewport camera pose whenever a sketch session opens through the standard sketch entry contract.
- Restore the captured pre-sketch camera pose through the same smooth transition whenever the sketch session exits through a supported path such as finish, commit, cancel, or escape.
- Keep free orbit, pan, and projection switching behavior unchanged outside these programmatic transitions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `viewport-view-cube-navigation`: Replace instantaneous principal-view and isometric snapping requirements with smooth programmatic camera transitions that preserve the active projection and shared control path.
- `viewport-runtime-parity`: Update the migrated-runtime camera navigation contract so programmatic orientation changes preserve the same outcomes while animating to the target view instead of snapping.
- `sketch-plane-alignment`: Extend sketch camera alignment requirements so sketch entry animates into the plane-aligned framed view and sketch exit restores the pre-entry camera pose.
- `sketch-entry-parity`: Require the same camera transition contract across all sketch entry points and supported sketch exit paths, including reopening an existing sketch.

## Impact

- Affected code will include viewport camera-control orchestration, view-cube navigation handlers, and sketch session entry/exit flow.
- Existing tests around camera navigation and sketch-mode transitions will need updates or additions to assert animated completion and restored post-sketch view state.
- No API or persistence format changes are expected; the main impact is runtime viewport behavior and supporting test coverage.
