## MODIFIED Requirements

### Requirement: Sketch solver SHALL support interactive dragged-handle solves
The sketch solver SHALL support solving a sketch with a temporary dragged point or handle target treated as a soft objective while authored constraints and dimensions remain hard, so the editor can preview valid constrained movement without committing invalid authored geometry and without refusing satisfiable movement.

#### Scenario: Drag target leaves valid degrees of freedom
- **WHEN** the editor asks the solver to move a dragged sketch point and the constraint system has a valid solution
- **THEN** the solver returns solved point and entity positions that preserve the authored constraints while moving the dragged point as close to the drag target as the constraints allow

#### Scenario: Drag target is unreachable but the sketch is satisfiable
- **WHEN** the drag target lies outside the feasible set of the authored constraints but a valid constrained solution exists
- **THEN** the solver returns a solved result at the closest feasible dragged-point position instead of a blocked result

#### Scenario: Drag solve cannot converge
- **WHEN** the solver cannot converge to any valid solution for a drag frame, or the input is invalid or stale
- **THEN** the solver returns a machine-readable blocked result instead of inventing invalid geometry
- **AND** unreachable-but-feasible drag targets are not reported as blocked

## ADDED Requirements

### Requirement: Interactive drag solves SHALL apply uniform minimum-motion regularization
The sketch solver SHALL include a weak uniform regularization objective that keeps every non-dragged free point near its previous accepted frame position, subordinate to hard constraints and to the drag target objective, so underconstrained drag solves resolve deterministically to minimum-motion solutions.

#### Scenario: Null space exists in the drag solve
- **WHEN** the drag solve system is underconstrained and admits multiple valid solutions
- **THEN** the regularization selects the solution with minimal displacement of non-dragged points from the previous accepted frame

#### Scenario: Regularization never overrides authored facts
- **WHEN** hard constraints require non-dragged geometry to move during an accepted drag frame
- **THEN** the accepted solution satisfies the hard constraints within tolerance
- **AND** the regularization only selects among valid solutions

#### Scenario: Regularization anchors follow the gesture
- **WHEN** a drag gesture accepts a frame
- **THEN** subsequent frames in the same gesture anchor the regularization to the most recent accepted frame values

### Requirement: Interactive drag solves SHALL NOT search discontinuous solution branches
The sketch solver SHALL solve interactive drag frames only by continuous iteration from the previous accepted frame values and SHALL NOT seed, explore, or accept reflected or otherwise discontinuous configuration branches during a drag.

#### Scenario: Continuous solve fails to converge
- **WHEN** a continuous drag-frame solve does not converge
- **THEN** the solver reports a blocked non-convergent result for that frame
- **AND** it does not fall back to mirrored or branch-searched candidate configurations

#### Scenario: Large drag target step
- **WHEN** a drag target update is farther from the previous accepted frame than the continuity step limit
- **THEN** the solver subdivides the target path into a bounded number of substeps solved continuously in sequence
- **AND** a non-convergent substep preserves the last accepted values

### Requirement: Rigid translation SHALL only be a verified drag optimization
The sketch solver SHALL treat whole-component rigid translation during point drags as an optional optimization that MUST produce the same result as the general minimum-motion drag solve, and SHALL NOT use it as an alternative behavior when the general solve would move geometry differently.

#### Scenario: Component is internally rigid
- **WHEN** a dragged point belongs to a component whose internal shape is fully determined and only translation freedom remains
- **THEN** the solver may satisfy the drag by rigid translation
- **AND** the result equals what the general minimum-motion drag solve would produce

#### Scenario: Component has internal degrees of freedom
- **WHEN** a dragged point belongs to a component with internal degrees of freedom
- **THEN** the drag is solved through the general minimum-motion path
- **AND** the solver does not rigidly translate the component merely because a translation would satisfy the constraints
