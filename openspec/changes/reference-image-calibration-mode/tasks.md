## 1. Build the isolated calibration domain and solver

- [ ] 1.1 Create dedicated reference-image calibration modules and a standalone solver folder separate from the main sketch solver.
- [ ] 1.2 Define operation-local calibration state, anchor records, calibration constraints, and solve-result contracts.
- [ ] 1.3 Implement locked-aspect and independent-scale solving paths behind the calibration scale-mode toggle.

## 2. Implement calibration mode

- [ ] 2.1 Add reference-image calibration mode entry, exit, and committed-operation targeting on top of the sketch special editor mode contract.
- [ ] 2.2 Implement the calibration panel sections for scale mode, anchor visibility, anchor and constraint management, image replacement, and diagnostics.
- [ ] 2.3 Implement viewport interactions for anchor creation, anchor selection, and calibration edits within the active reference-image mode.

## 3. Export fixed anchor reference points

- [ ] 3.1 Derive read-only fixed anchor reference points from solved calibration results.
- [ ] 3.2 Expose only anchor points, and no guide geometry, to the main sketch for snapping and constraint targeting.
- [ ] 3.3 Refresh exported anchor points after recalibration or image replacement and respect the normal-mode visibility toggle defaulting to off.

## 4. Remove remaining image-solver coupling and verify behavior

- [ ] 4.1 Delete any remaining dependencies on `pointOnImage`-style or main-sketch image-solving paths.
- [ ] 4.2 Add tests proving calibration uses only the dedicated reference-image solver and that the main sketch consumes only fixed exported anchors.
- [ ] 4.3 Add tests proving image replacement preserves anchor UV locations across the new inline image payload model.
