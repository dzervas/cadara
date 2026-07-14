# Verification Notes

Date: 2026-07-15

## Real capture smoke

Both ignored local captures were imported through the browser workbench at `http://127.0.0.1:3000`:

- `40a51fb8fa82fd4565151114.onshape-capture.json`
- `9841e486906fa2ce62d74d8e.onshape-capture.json`

Constrained sketch dragging was user-confirmed to move the dependent parametric body correctly. Variable edits were exercised in-app (`nail` in the first capture and `walls` in the second); the translated sketches re-solved without losing their durable regions.

The first capture still has an import-fidelity boundary after the translated base Sketch 1 / Extrude 1: Sketch 2, Extrude 2, Transform 1, and Chamfer 1 remain represented by final-state baked geometry. That static downstream checkpoint cannot parametrically recompute and is outside this sketch-relationship change.

## Relationship review counts

Counts are recorded as `carried / dropped` from each real bundle's provider review.

### `40a51fb8fa82fd4565151114` — Mounts

| Sketch | Constraints | Dimensions | Derivations |
| --- | ---: | ---: | ---: |
| Sketch 1 (`FOoap8tw3jKAJf5_0`) | 17 / 4 | 5 / 0 | 0 / 0 |

### `9841e486906fa2ce62d74d8e` — Part Studio 1

| Sketch | Constraints | Dimensions | Derivations |
| --- | ---: | ---: | ---: |
| Sketch 1 (`FNfjwjJwNNnCXGi_0`) | 0 / 1 | 1 / 1 | 0 / 0 |
| Side Outline (`FM7pO6bOzAH3TLZ_1`) | 9 / 3 | 3 / 0 | 0 / 0 |
| Sketch 8 (`Fb9DPKIwfaXrtCQ_1`) | 10 / 10 | 3 / 0 | 0 / 0 |

Only sketches eligible for relationship translation appear in the review summary; sketches suppressed behind unsupported/baked lineage are not reported as committed parametric sketches.

## Automated validation

- Real-solver apply-pipeline coverage verifies seeded position stability and isolation/degradation of a deliberately wrong translated dimension.
- Checked-in provider/planner fixtures carry a local constraint, expression-backed dimension, and offset derivation.
- `bun run test:all` passed, including 55 Playwright tests.
