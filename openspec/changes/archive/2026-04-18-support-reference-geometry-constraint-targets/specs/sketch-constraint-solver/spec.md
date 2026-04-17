## ADDED Requirements

### Requirement: Sketch solver SHALL evaluate supported constraints against projected references
The sketch solver SHALL consume projected external reference geometry as read-only input when evaluating supported reference-targeted constraints.

#### Scenario: Reference-targeted constraint is satisfiable
- **WHEN** the authored sketch contains a supported constraint between local geometry and valid projected reference geometry
- **THEN** the solver returns solved local geometry that satisfies the relationship within tolerance

#### Scenario: Reference-targeted constraint is invalidated
- **WHEN** the projected reference geometry required by a constraint is missing from the solve request
- **THEN** the solver reports an unsatisfied or invalid diagnostic for the authored constraint without inventing fallback geometry
