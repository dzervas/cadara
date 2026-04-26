## 1. Runtime Activation Adoption

- [x] 1.1 Add a shared editor-runtime helper that replays the current ordered selection through a destination tool's selection rules and returns either the full adopted selection or an empty cleared result.
- [x] 1.2 Update `tool.activated` handling to use that helper before entering `Sketch`, sketch-edit, and feature create workflows, preserving empty-selection activation and clearing incompatible non-empty selections.

## 2. Sketch Activation Flows

- [x] 2.1 Extend sketch-start activation so `Sketch` immediately opens from one valid preselected planar target and otherwise clears incompatible prior selection before entering sketch-start picking.
- [x] 2.2 Extend sketch edit-tool activation to accept compatible initial selected targets, seed edit-tool preview/validation state from them, and keep `offset` working across multi-entity preselection.
- [x] 2.3 Add or update sketch/runtime tests covering valid sketch-start preselection, invalid sketch-start clearing, valid offset preselection reuse, and invalid offset clearing.

## 3. Feature Session Seeding

- [x] 3.1 Evolve feature session creation to accept ordered selected targets, seed the initial draft from the first target, and replay remaining adopted targets through feature authoring `applySelection`.
- [x] 3.2 Update feature activation paths and representative feature authoring tests so compatible current selections seed create sessions while incompatible selections are cleared instead of partially applied.

## 4. Regression Coverage

- [x] 4.1 Add or update editor state-machine tests for activation-time selection adoption and clear-on-invalid behavior across sketch and feature tool entry points.
- [x] 4.2 Run the required verification commands and address any regressions introduced by the new activation and selection-seeding paths.
