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
The system SHALL evaluate supported sketch constraints and dimensions as explicit solver-owned loss terms with analytical gradients over the sketch parameter vector, so convergence behavior is deterministic and testable. Horizontal and vertical line constraints SHALL be interpreted in sketch-plane coordinates rather than world-space axes.

#### Scenario: Supported line and point constraints are present
- **WHEN** the authored sketch contains supported distance, angle, coincidence, horizontal, vertical, parallel, perpendicular, equal-length, or arc-endpoint constraints
- **THEN** the solver evaluates those authored facts as explicit loss terms and uses their analytical gradients during iteration

#### Scenario: Horizontal and vertical use sketch-plane axes
- **WHEN** the authored sketch contains a horizontal or vertical line constraint on any supported sketch plane
- **THEN** the solver evaluates that line orientation against the sketch plane local horizontal or vertical axis
- **AND** the solved result does not reinterpret the constraint against world-space axes

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

### Requirement: Sketch solver SHALL evaluate expanded driving dimension kinds
The sketch solver SHALL evaluate durable diameter, line-to-line distance, line-to-point distance, and line-to-line angle dimensions as solver-owned driving dimension terms.

#### Scenario: Diameter dimension drives a circle
- **WHEN** the authored sketch contains a diameter dimension for a supported circle entity
- **THEN** the solver treats half of the authored diameter value as the target solved radius
- **AND** the solved dimension status reports the diameter value represented by the solved circle

#### Scenario: Diameter dimension drives an arc
- **WHEN** the authored sketch contains a diameter dimension for a supported arc entity
- **THEN** the solver treats half of the authored diameter value as the target solved arc radius
- **AND** the solved dimension status reports the diameter value represented by the solved arc

#### Scenario: Line-to-line distance dimension drives parallel lines
- **WHEN** the authored sketch contains a line-to-line distance dimension between two supported parallel line entities
- **THEN** the solver drives the perpendicular separation between the solved line references to the authored value within tolerance
- **AND** the solved dimension status reports the solved perpendicular distance

#### Scenario: Line-to-point distance dimension drives a point
- **WHEN** the authored sketch contains a line-to-point distance dimension between a supported line entity and point
- **THEN** the solver drives the point's perpendicular distance from the solved line reference to the authored value within tolerance
- **AND** the solved dimension status reports the solved perpendicular distance

#### Scenario: Angle dimension drives non-parallel lines
- **WHEN** the authored sketch contains an angle dimension between two supported non-parallel line entities
- **THEN** the solver drives the signed or selected-angle relationship between the solved line references to the authored angle value within tolerance
- **AND** the solved dimension status reports the solved angle value

### Requirement: Sketch solver SHALL report invalid expanded dimensions without fallback geometry
The sketch solver SHALL reject expanded dimension records that reference missing, unsupported, degenerate, or incompatible geometry without inventing replacement targets.

#### Scenario: Dimension target is missing
- **WHEN** an expanded dimension references a point or entity that is absent from the sketch definition
- **THEN** the solver reports the dimension as unsatisfied or invalid
- **AND** it does not create fallback points, lines, arcs, or circles

#### Scenario: Line-to-line distance uses non-parallel lines
- **WHEN** a line-to-line distance dimension references two non-parallel line entities
- **THEN** the solver reports the dimension as unsatisfied or invalid
- **AND** it does not reinterpret the record as an angle dimension

#### Scenario: Angle dimension uses parallel or degenerate lines
- **WHEN** an angle dimension references parallel or degenerate line entities
- **THEN** the solver reports the dimension as unsatisfied or invalid
- **AND** it does not synthesize an arbitrary angle

### Requirement: Sketch solve contract SHALL decouple solving from region extraction
The sketch solver contract SHALL allow callers to solve sketch geometry without deriving regions as mandatory work, and SHALL expose region extraction as an explicit operation or caller-selected solve option.

#### Scenario: Caller requests solved geometry only
- **WHEN** a caller submits a sketch solve request without requesting region extraction
- **THEN** the response returns solved status, solved geometry, constraint statuses, dimension statuses, and solve diagnostics
- **AND** the response does not derive or require derived region records

#### Scenario: Caller explicitly requests regions
- **WHEN** a caller requests region extraction for a solved sketch basis
- **THEN** the solver or region-extraction boundary derives regions from the requested solved snapshot and authored definition
- **AND** region diagnostics are returned with the region extraction result rather than hidden inside an unrelated solve response

### Requirement: Sketch solver SHALL expose explicit interactive solve lifecycle
The sketch solver contract SHALL expose an explicit interactive solve lifecycle for drag-style edits instead of relying on a stateless drag target plus advisory incremental hints.

#### Scenario: Interactive solve session starts
- **WHEN** the editor begins a constrained sketch drag for a supported sketch point or handle
- **THEN** the solver creates or reuses a compatible compiled solve basis and returns an interactive session that can be updated by subsequent drag moves

#### Scenario: Interactive solve session updates
- **WHEN** the editor submits a new drag target for an active interactive solve session
- **THEN** the solver updates the session from its previous numeric state and returns the accepted solved geometry or a machine-readable blocked result

#### Scenario: Interactive solve session ends
- **WHEN** the editor ends or cancels the drag lifecycle
- **THEN** the solver finalizes or disposes the interactive session
- **AND** no later drag update for that session is applied to the sketch draft

### Requirement: Solver incremental contract SHALL replace advisory edit hints
The solver contract SHALL replace advisory incremental edit hints with deterministic compatibility and invalidation behavior for compiled programs and interactive sessions.

#### Scenario: Compatible numeric edit occurs
- **WHEN** only numeric values compatible with the existing compiled basis change between interactive solve updates
- **THEN** the solver reports the session as reusable and continues from the existing compiled program

#### Scenario: Incompatible graph edit occurs
- **WHEN** the authored sketch graph or projected reference basis changes in a way that invalidates compiled variables or equations
- **THEN** the solver reports the prior compiled basis as incompatible
- **AND** callers must start a new compiled solve basis before reusing incremental behavior

### Requirement: Solver diagnostics SHALL remain explicit during optimized solves
Optimized full and interactive solve paths SHALL preserve machine-readable diagnostics for invalid input, missing projected references, inconsistent constraints, blocked drag targets, stale sessions, and non-convergent solves.

#### Scenario: Optimized solve cannot converge
- **WHEN** a full or interactive optimized solve cannot satisfy the authored system within tolerance
- **THEN** the solver returns a failed, partially solved, blocked, unsatisfied, or non-convergent machine-readable result as appropriate
- **AND** it does not commit invalid solved geometry as if it were satisfied

#### Scenario: Projected reference is missing
- **WHEN** an optimized solve requires projected reference geometry that is absent or invalid for the active basis
- **THEN** the solver reports an explicit diagnostic for the missing or invalid projected reference
- **AND** it does not use stale cached projected coordinates as a fallback

### Requirement: Solver benchmarks SHALL cover interactive incremental performance
The repository SHALL benchmark representative full and interactive sketch solve paths so solver changes can be evaluated against common constraint counts and drag behavior.

#### Scenario: Developer runs incremental solver benchmark
- **WHEN** the solver benchmark is executed
- **THEN** it reports timing for full solves and interactive drag-frame solves on representative 10-constraint, 50-constraint, and 150-constraint fixtures

#### Scenario: Benchmark includes independent components
- **WHEN** the benchmark includes a sketch fixture with multiple independent connected solver components
- **THEN** it reports drag-frame timing for solving one affected component without solving unrelated components

### Requirement: Sketch solver SHALL evaluate collinear constraints
The sketch solver SHALL evaluate durable collinear constraints as solver-owned line-equation terms for supported local point, local line, projected line, and datum line operands.

#### Scenario: Local line-to-line collinear constraint solves
- **WHEN** the authored sketch contains a collinear relationship between two non-degenerate local line segments
- **THEN** the solver keeps the driven line endpoints on the reference line's infinite geometry within tolerance
- **AND** the constraint status reports satisfied when the relationship is solved

#### Scenario: Local point-to-line collinear constraint solves
- **WHEN** the authored sketch contains a collinear relationship between an editable local point and a non-degenerate line
- **THEN** the solver keeps the point on the line's infinite geometry within tolerance
- **AND** the constraint status reports satisfied when the relationship is solved

#### Scenario: Projected line collinear constraint solves
- **WHEN** the authored sketch contains a collinear relationship between an editable local target and a projected line reference
- **THEN** the solver uses the projected line as read-only input
- **AND** it moves only editable local sketch geometry to satisfy the relationship

### Requirement: Sketch solver SHALL diagnose invalid collinear constraints
The sketch solver SHALL report invalid or unsatisfied diagnostics for collinear constraints with missing operands, unsupported operand kinds, or degenerate reference lines.

#### Scenario: Collinear target is missing
- **WHEN** a collinear constraint references a point, entity, projected reference, or datum line that is unavailable in the solve request
- **THEN** the solver reports the constraint as invalid or unsatisfied
- **AND** it does not invent fallback geometry

#### Scenario: Collinear reference is degenerate
- **WHEN** a collinear constraint uses a line operand whose endpoints are coincident within tolerance
- **THEN** the solver reports an invalid or unsatisfied diagnostic for that constraint
- **AND** it does not normalize the line to an arbitrary direction

### Requirement: Sketch solver performance telemetry SHALL be captured at solver service seams
The sketch solver SHALL record sampled performance spans at solver service operations without embedding telemetry in residual evaluation, numeric iteration loops, region traversal internals, or sketch editor presentation code.

#### Scenario: Full solve is requested
- **WHEN** a caller requests sketch solving through the solver service boundary
- **THEN** performance telemetry records one solve span
- **AND** the span can include cheap counts such as point count, entity count, constraint count, dimension count, projected-reference count, diagnostic count, solve state, and constraint state

#### Scenario: Region extraction is requested
- **WHEN** a caller requests region extraction through the solver service boundary or as an explicit solve option
- **THEN** performance telemetry records the region-extraction operation at that boundary
- **AND** the span does not calculate expensive geometric summaries beyond counts already returned by region extraction

#### Scenario: Solver internals iterate
- **WHEN** the solver evaluates many residuals, gradients, or numeric iterations during a solve
- **THEN** performance telemetry does not emit per-residual, per-gradient, per-iteration, or per-constraint-term spans

### Requirement: Sketch drag telemetry SHALL be gesture-level
Constrained sketch drag performance telemetry SHALL be aggregated at the drag gesture lifecycle rather than emitted per pointer move.

#### Scenario: Drag gesture completes
- **WHEN** a constrained sketch drag starts, receives one or more updates, and ends or cancels
- **THEN** performance telemetry emits at most one drag gesture span
- **AND** the span can include aggregate update count, accepted update count, blocked update count, total elapsed time, and maximum observed update duration when those values are available at the gesture seam

#### Scenario: Drag updates occur at pointer frequency
- **WHEN** a drag gesture receives many pointer-rate updates
- **THEN** performance telemetry does not emit one span per update

