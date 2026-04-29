## 1. Tool metadata and explicit authoring

- [x] 1.1 Add `constraintHorizontal` and `constraintVertical` shared tool/icon IDs and map them to the existing `sketch-horizontal.svg` and `sketch-vertical.svg` assets.
- [x] 1.2 Register Horizontal and Vertical in the sketch constraint registry as single-line local tools that commit the existing durable `horizontal` and `vertical` constraint kinds without value entry.
- [x] 1.3 Update shared constraint presentation/icon resolution so committed horizontal and vertical constraints use the matching toolbar/history glyphs.

## 2. Sketch-session behavior coverage

- [x] 2.1 Add or update toolbar and registry tests to verify Horizontal and Vertical appear as sketch-only constraint tools.
- [x] 2.2 Add authoring tests that verify selecting a local line commits a durable horizontal or vertical constraint and does not create a dimension record.
- [x] 2.3 Add invalid-target and annotation tests that verify unsupported picks do not commit partial constraints and committed constraints use the expected glyphs.

## 3. Solver-axis semantics verification

- [x] 3.1 Add regression coverage that verifies horizontal and vertical constraints are solved in sketch-plane coordinates rather than world-space axes.
- [x] 3.2 Adjust solver or sketch-plane helper logic only if needed so non-XY sketch supports preserve the documented local horizontal and vertical behavior.
