## 1. Build the isolated calibration domain and solver

- [x] 1.1 Create dedicated reference-image calibration modules and a standalone solver folder separate from the main sketch solver.
- [x] 1.2 Define operation-local calibration state, anchor records, calibration constraints, and solve-result contracts.
- [x] 1.3 Implement locked-aspect and independent-scale solving paths behind the calibration scale-mode toggle.

## 2. Implement calibration mode

- [x] 2.1 Add reference-image calibration mode entry, exit, and committed-operation targeting on top of the sketch special editor mode contract.
- [x] 2.2 Implement the calibration panel sections for scale mode, anchor visibility, anchor and constraint management, image replacement, and diagnostics.
- [x] 2.3 Implement viewport interactions for anchor creation, anchor selection, and calibration edits within the active reference-image mode.

## 3. Export fixed anchor reference points

- [x] 3.1 Derive read-only fixed anchor reference points from solved calibration results.
- [x] 3.2 Expose only anchor points, and no guide geometry, to the main sketch for snapping and constraint targeting.
- [x] 3.3 Refresh exported anchor points after recalibration or image replacement and respect the normal-mode visibility toggle defaulting to off.

## 4. Remove remaining image-solver coupling and verify behavior

- [x] 4.1 Delete any remaining dependencies on `pointOnImage`-style or main-sketch image-solving paths.
- [x] 4.2 Add tests proving calibration uses only the dedicated reference-image solver and that the main sketch consumes only fixed exported anchors.
- [x] 4.3 Add tests proving image replacement preserves anchor UV locations across the new inline image payload model.
