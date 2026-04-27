## Why

Reference-image calibration needs specialized editing semantics, but the image itself should not be woven into the main sketch solver. This change adds a dedicated calibration mode and a dedicated calibration solver so image transform solving remains isolated, extensible, and structurally clean.

## What Changes

- Add a `referenceImage` calibration mode built on the sketch special editor mode contract.
- Add a dedicated reference-image calibration solver in its own folder and subsystem; it SHALL NOT be woven into the main sketch solver implementation.
- Solve only operation-local calibration state: image transform, anchor definitions, and calibration constraints. The main sketch solver SHALL treat exported anchor results as fixed reference geometry.
- Add calibration form controls that follow feature-editor-like panel structure, including a scale-mode toggle and an anchor-visibility toggle that defaults to off in normal sketch editing.
- Allow image replacement inside calibration mode while preserving existing anchor UV locations.
- Export only calibrated anchor points, not guide lines or other image-owned geometry, into the main sketch as read-only fixed reference points available for snapping and constraints.

## Capabilities

### New Capabilities
- `reference-image-calibration`: dedicated reference-image calibration mode, dedicated calibration solver, anchor editing, image replacement, and calibration-form behavior
- `reference-image-anchor-reference-points`: export calibrated image anchors into the main sketch as read-only fixed reference points

### Modified Capabilities
- None

## Impact

- Affected areas include the new reference-image calibration domain, sketch-mode viewport interaction routing, sketch-mode side panels, read-only reference-point exposure to the main sketch, and replacement of the current image-specific solver path.
- The change introduces a new isolated solver subsystem that is intentionally structured for future extension instead of being embedded inside the generic sketch solver.
- This change depends on the new reference-image sketch operation contract and the new sketch special editor mode infrastructure being in place first.
