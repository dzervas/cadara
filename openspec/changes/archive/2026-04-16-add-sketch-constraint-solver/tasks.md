## 1. Contract And Spec Work

- [x] 1.1 Extend the sketch contract schema with the authored constraint and dimension variants required by the 2D solver math and test fixtures.
- [x] 1.2 Add the dedicated sketch-constraint-solver spec and the frontend-modeling-boundary delta for solver-boundary behavior.

## 2. Sketch-Only Solver Core

- [x] 2.1 Implement a separate sketch-only TypeScript solver module under `src/contracts/sketch` with flat parameter storage, analytical losses, gradients, and a BFGS-based solve loop.
- [x] 2.2 Implement validation, solved-geometry projection, and solved status reporting in that module using only sketch-contract types.
- [x] 2.3 Add sketch-domain ring and region extraction utilities and move loop extraction out of adapter-local code.
- [x] 2.4 Add gradient-descent, Gauss-Newton, and Levenberg-Marquardt solve strategies over the shared sketch residual model.

## 3. Adapter Integration

- [x] 3.1 Add a dedicated `SketchSolverAdapter` implementation that delegates solve math to the new sketch-only solver core while preserving the existing request/response envelopes.
- [x] 3.2 Update runtime wiring and solver-facing tests to use the new adapter where real 2D solving is expected.

## 4. Direct Test Ports

- [x] 4.1 Port the upstream primitive and constraint tests into TypeScript solver tests without referencing the upstream project name.
- [x] 4.2 Port the axis-aligned and rotated rectangle solve fixtures into TypeScript and verify convergence against the new solver implementation.
- [x] 4.3 Add direct tests for sketch-domain ring and derived-region extraction equivalent to the upstream ring-finding fixtures.
- [x] 4.4 Add direct tests proving the rotated rectangle fixture solves under each supported iterative strategy within documented tolerances.
