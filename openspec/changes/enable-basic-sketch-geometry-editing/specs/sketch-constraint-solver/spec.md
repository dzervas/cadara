## ADDED Requirements

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
