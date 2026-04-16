## Why

The current CAD webview mixes placeholder viewport visuals with kernel-authored construction renderables in ways that make sketch editing harder to read and harder to control. Sketch vertices no longer match the intended sphere markers, datum planes visually collide with sketch edges, the colored origin planes are decorative rather than authoritative, left click selection in the viewport currently does nothing, and there is no working hide/show affordance for tree items.

## What Changes

- Restore sketch vertex rendering so sketch-session point markers are displayed as small spherical markers instead of square point sprites.
- Separate datum plane visuals from sketch geometry by rendering origin planes with a neutral, highly transparent gray treatment that remains distinguishable when sketches overlap them.
- Align the authoritative datum plane renderables with the viewport’s intended origin-plane treatment so the scene uses the seeded origin planes instead of duplicating decorative planes while also showing kernel `construction_plane-*` records.
- Restore working left-click selection so viewport picks resolve against the rendered scene and selectable datum or object targets respond to primary click input.
- Reintroduce a hide/show control in the workbench sidebar and make visibility toggles affect viewport rendering for constructions and other tree/object entries.

## Capabilities

### New Capabilities
- `webview-visibility-and-datum-rendering`: Consistent viewport rendering and visibility control for sketch markers, datum planes, and sidebar-managed scene items.

### Modified Capabilities

## Impact

- Affected code in the Three.js viewport, workspace render scene builders, scene factory helpers, and sidebar presentation components.
- Affected code likely includes viewport picking/selection plumbing in addition to rendering and sidebar presentation.
- Requires document/view-model support for per-item visibility state if that state is not already available from the editor layer.
- Impacts viewport interaction readability, sketch authoring ergonomics, and object-tree workflows, but does not change CAD feature semantics or kernel geometry generation.
