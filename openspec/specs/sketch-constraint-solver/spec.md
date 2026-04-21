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

### Requirement: Region extraction SHALL use even-parity nesting to distinguish regions from holes
The system SHALL classify extracted rings as regions or holes based on topological nesting depth so that outer boundaries, holes, and islands are handled correctly.

#### Scenario: Outer ring contains an inner ring
- **WHEN** a solved sketch produces a closed outer ring that fully contains a closed inner ring
- **THEN** the outer ring at even nesting depth is classified as a region and the inner ring at odd nesting depth is classified as a hole

#### Scenario: Island inside a hole
- **WHEN** a solved sketch produces a ring nested inside a hole (depth 2)
- **THEN** that ring is classified as an independent region at even nesting depth

### Requirement: Region extraction SHALL reject self-intersecting rings
The system SHALL validate that candidate rings do not self-intersect and SHALL report a diagnostic for rings that fail validation, except for primitive closed curves known to be valid.

#### Scenario: Self-intersecting ring is rejected
- **WHEN** a candidate ring derived from solved sketch geometry contains self-intersecting segments
- **THEN** region extraction rejects the ring, does not include it in derived regions, and emits a `profile-invalid-ring` diagnostic

#### Scenario: Closed primitive curve bypasses self-intersection check
- **WHEN** a candidate ring is formed by a single closed primitive curve such as a circle or ellipse
- **THEN** region extraction skips the self-intersection check for that ring

### Requirement: Region extraction SHALL emit diagnostics for degenerate and unused segments
The system SHALL report machine-readable diagnostics for segments that are too short, open-ended, or otherwise cannot participate in valid ring formation.

#### Scenario: Degenerate segment is reported
- **WHEN** a solved sketch segment has near-zero length
- **THEN** region extraction emits a `profile-degenerate-segment` diagnostic and excludes the segment from ring formation

#### Scenario: Open segment is reported
- **WHEN** a solved sketch segment endpoint does not connect to any other segment endpoint within tolerance
- **THEN** region extraction emits a `profile-open-segment` diagnostic for that endpoint

### Requirement: Region IDs SHALL be content-stable across solve iterations
The system SHALL derive region identifiers from the geometric content of region loops so that region identity is stable across re-solves that do not change the topological structure.

#### Scenario: Unchanged geometry preserves region ID
- **WHEN** a sketch is re-solved and the derived region loops contain the same geometric content
- **THEN** the region IDs produced by extraction match the IDs from the previous solve

#### Scenario: Changed geometry produces a new region ID
- **WHEN** a sketch edit changes the geometric content of a region loop
- **THEN** the region extraction produces a different region ID for the changed loop

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

### Requirement: Sketch solver SHALL evaluate supported constraints against projected references
The sketch solver SHALL consume projected external reference geometry as read-only input when evaluating supported reference-targeted constraints.

#### Scenario: Reference-targeted constraint is satisfiable
- **WHEN** the authored sketch contains a supported constraint between local geometry and valid projected reference geometry
- **THEN** the solver returns solved local geometry that satisfies the relationship within tolerance

#### Scenario: Reference-targeted constraint is invalidated
- **WHEN** the projected reference geometry required by a constraint is missing from the solve request
- **THEN** the solver reports an unsatisfied or invalid diagnostic for the authored constraint without inventing fallback geometry

### Requirement: Sketch solver SHALL evaluate inferred constraint kinds
The sketch solver SHALL evaluate durable constraint kinds required by supported snap-derived relationships, including midpoint, point-on-curve, tangent, and concentric constraints.

#### Scenario: Midpoint constraint solves
- **WHEN** a sketch contains a midpoint constraint between a point and a line
- **THEN** the solver positions the point at the solved midpoint of the line when the system is satisfiable

#### Scenario: Tangent constraint solves
- **WHEN** a sketch contains a supported tangent constraint between two supported curve entities
- **THEN** the solver satisfies the tangency relationship within tolerance or reports an unsatisfied diagnostic

### Requirement: Region extraction SHALL emit projected geometry segments for live-derived reference profiles
The sketch region extraction subsystem SHALL include projected geometry segment sources when valid projected reference geometry participates in a closed loop.

#### Scenario: Mixed loop contains projected segment
- **WHEN** solved local sketch geometry and projected reference geometry form a valid closed loop
- **THEN** derived region loop segments identify local entity sources and projected geometry sources in traversal order

#### Scenario: Projected segment cannot be resolved
- **WHEN** projected geometry required for loop extraction is unavailable or invalid
- **THEN** region extraction reports diagnostics and does not invent copied local geometry

