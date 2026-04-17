# sketch-constraint-solver Specification

## Purpose
TBD - created by archiving change add-sketch-constraint-solver. Update Purpose after archive.
## Requirements
### Requirement: Sketch solving SHALL be implemented as a sketch-only 2D constraint subsystem
The system SHALL provide a dedicated 2D sketch solver that consumes authored sketch definitions and produces solved sketch geometry using only the sketch contract types, without importing kernel-specific modules or frontend interaction state.

#### Scenario: Modeling code requests a solve
- **WHEN** the modeling boundary issues a sketch solve request
- **THEN** the solve math is executed by a dedicated sketch-only subsystem that depends only on sketch-contract data and numeric helpers

#### Scenario: Solver module is tested directly
- **WHEN** a unit test constructs an authored sketch definition with supported constraints and dimensions
- **THEN** the sketch solver can validate and solve that definition without requiring kernel adapters, viewport state, or editor sessions

### Requirement: Sketch solver SHALL support analytical least-squares evaluation for supported authored constraints
The system SHALL evaluate supported sketch constraints and dimensions as explicit solver-owned loss terms with analytical gradients over the sketch parameter vector, so convergence behavior is deterministic and testable.

#### Scenario: Supported line and point constraints are present
- **WHEN** the authored sketch contains supported distance, angle, coincidence, horizontal, vertical, parallel, perpendicular, equal-length, or arc-endpoint constraints
- **THEN** the solver evaluates those authored facts as explicit loss terms and uses their analytical gradients during iteration

#### Scenario: A supported driving dimension is present
- **WHEN** the authored sketch contains a supported distance or radius dimension
- **THEN** the solver treats that authored dimension as a driving solve term and reports the solved value in the solved snapshot

### Requirement: Sketch solver SHALL expose deterministic solve outcomes through the existing solved-sketch contract
The system SHALL return solved points, solved entities, per-constraint statuses, per-dimension statuses, and machine-readable solve state using the existing solved sketch schema.

#### Scenario: Solve converges for a valid constrained sketch
- **WHEN** the solver reaches a valid low-loss solution for a supported authored sketch
- **THEN** the response reports `solveState: solved`, returns authoritative solved geometry, and reports satisfied/driving statuses for the solved authored constraints and dimensions

#### Scenario: Solve cannot satisfy the authored system fully
- **WHEN** the solver detects invalid input, inconsistent constraints, or non-convergent results
- **THEN** it returns machine-readable diagnostics and an appropriate solved-sketch status instead of inventing unsourced geometry

### Requirement: Sketch contract SHALL own ring and region extraction behavior
The system SHALL define loop, ring, and derived region extraction as sketch-domain behavior that operates on solved sketch geometry and remains outside kernel-specific adapter code.

#### Scenario: Solver derives closed loops from solved sketch geometry
- **WHEN** a solved sketch contains connected line, arc, or circle geometry that forms closed boundaries
- **THEN** the sketch-domain extraction logic identifies closed loops and exposes them as sketch-owned derived region data

#### Scenario: Modeling adapter needs derived sketch regions
- **WHEN** a modeling adapter requests derived regions for a solved sketch
- **THEN** it consumes region extraction from the sketch-domain subsystem instead of reimplementing ring traversal inside adapter code

### Requirement: Sketch contract SHALL expose multiple deterministic solve strategies
The system SHALL support multiple sketch-domain solve strategies for the same authored constraint system so direct tests can verify equivalent behavior across supported iterative methods.

#### Scenario: Rotated rectangle fixture is solved with an alternative strategy
- **WHEN** the sketch-domain solver evaluates a supported sketch using gradient-descent, Gauss-Newton, Levenberg-Marquardt, or BFGS strategy selection
- **THEN** each supported strategy returns a valid solved sketch result within the documented tolerance for that fixture

### Requirement: Sketch solver SHALL support interactive dragged-handle solves
The sketch solver SHALL support solving a sketch with a temporary dragged point or handle target so the editor can preview valid constrained movement without committing invalid authored geometry.

#### Scenario: Drag target leaves valid degrees of freedom
- **WHEN** the editor asks the solver to move a dragged sketch point and the constraint system has a valid solution
- **THEN** the solver returns solved point and entity positions that preserve the authored constraints while honoring the drag target within tolerance

#### Scenario: Drag target cannot be satisfied
- **WHEN** the editor asks the solver to move a dragged sketch point and the constraint system cannot satisfy the requested movement
- **THEN** the solver returns a machine-readable unsatisfied or non-convergent result instead of inventing invalid geometry

### Requirement: Sketch solver performance SHALL be benchmarked for common constraint counts
The repository SHALL include a simple benchmark that measures sketch solve elapsed time for representative sketches with 10, 50, and 150 constraints.

#### Scenario: Developer runs the solver benchmark
- **WHEN** the solver benchmark is executed
- **THEN** it reports solve timing for 10-constraint, 50-constraint, and 150-constraint sketch fixtures

