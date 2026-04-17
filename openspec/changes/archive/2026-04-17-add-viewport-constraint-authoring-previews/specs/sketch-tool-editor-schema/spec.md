## ADDED Requirements

### Requirement: Sketch tool schema SHALL describe transient constraint preview geometry
The sketch tool presentation schema SHALL support descriptors for transient constraint preview geometry including dimension lines, extension lines, angle arcs, and preview labels.

#### Scenario: Constraint tool emits a dimension preview
- **WHEN** an active constraint tool has enough target information to preview a dimension
- **THEN** the schema can describe the dimension line, label anchor, and related extension geometry without requiring constraint-specific React branches

#### Scenario: Constraint tool emits an angle preview
- **WHEN** an active constraint tool has enough target information to preview an angle
- **THEN** the schema can describe the angle arc and label anchor without requiring viewport code to infer the constraint type
