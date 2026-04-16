## Why

The current sketch solver path is a placeholder that validates authored graph shape but does not perform real 2D constraint solving. The workbench now needs a deterministic TypeScript solver that can satisfy sketch constraints and dimensions using only the sketch contracts, so the modeling boundary can remain replaceable and the math can be tested independently from kernel code.

## What Changes

- Add a dedicated sketch-constraint solving capability with a TypeScript implementation that operates only on `src/contracts/sketch` data.
- Extend the sketch contract to represent the line, angle, radius, and arc endpoint constraints needed by the 2D solver math and its direct test fixtures.
- Introduce a solver adapter that serves the existing `SketchSolverAdapter` boundary by delegating solve math to the new sketch-only module.
- Add direct TypeScript ports of the upstream Rust solver tests to lock down constraint math, convergence behavior, and canonical rectangle fixtures.

## Capabilities

### New Capabilities
- `sketch-constraint-solver`: Defines the contract and behavior for a dedicated 2D sketch constraint solver that consumes authored sketch records, produces solved geometry, and remains isolated from kernel-specific code.

### Modified Capabilities
- `frontend-modeling-boundary`: Sketch solving for commit and rebuild flows must continue to pass through the modeling/solver boundary while allowing a dedicated sketch-only solver implementation behind that interface.

## Impact

- Affected code: `src/contracts/sketch`, `src/contracts/solver`, `src/domain/solver`, modeling adapter wiring, and new solver-focused test files.
- APIs: sketch constraint and dimension unions expand to cover solver-needed authored inputs.
- Systems: sketch validation, solve status production, and region derivation will move from placeholder behavior to real 2D constraint evaluation.
