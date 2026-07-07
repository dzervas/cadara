## ADDED Requirements

### Requirement: Local sketch constraints, dimensions, and derivations SHALL translate
The sketch translator SHALL map local Onshape constraint records to `ConstraintDefinition` kinds with parsed operands, dimensional records to cadara dimensions with expression-backed values, and MIRROR/LINEAR_PATTERN/OFFSET records to sketch derivations; the previously-amended "constraints deferred" behavior is replaced.

#### Scenario: Local constraints survive import
- **WHEN** a captured sketch carries local COINCIDENT, MIDPOINT, HORIZONTAL, VERTICAL, PARALLEL, PERPENDICULAR, or EQUAL records between translated entities
- **THEN** the committed sketch contains the corresponding constraint definitions with correctly parsed point/entity operands
- **AND** dragging constrained geometry in cadara preserves the translated relationships

#### Scenario: Dimensions re-drive from variables
- **WHEN** a captured DISTANCE/LENGTH/DIAMETER/ANGLE record carries an expression referencing an imported document variable
- **THEN** the committed dimension's value is expression-backed
- **AND** changing the variable re-solves the sketch

#### Scenario: Derivations translate
- **WHEN** a captured sketch carries MIRROR, LINEAR_PATTERN, or OFFSET records over translated entities
- **THEN** the committed sketch contains the corresponding `mirror`, `linearPattern`, or `offset` derivation with master and derived sets mapped

#### Scenario: Untranslatable record degrades alone
- **WHEN** a constraint record cannot be translated (unsupported kind, operand referencing a dropped entity, external operand without imported projection geometry)
- **THEN** that record is dropped with a structured diagnostic naming kind, operands, and reason
- **AND** the sketch and its remaining constraints still import

### Requirement: Translated constraint sets SHALL be verified against the seeded solved state
After translation, the sketch SHALL solve to the seeded Onshape positions within tolerance; a beyond-tolerance solve SHALL be reported per-sketch with diagnostics isolating the offending records, and the import SHALL NOT silently ship geometry that the translated constraints move.

#### Scenario: Faithful translation is position-stable
- **WHEN** a translated sketch solves
- **THEN** solved positions match the seeded state within tolerance

#### Scenario: Translation bug detected
- **WHEN** the translated constraint set moves geometry beyond tolerance
- **THEN** the sketch's fidelity report identifies the deviation and the isolated offending records
- **AND** the affected records are dropped with diagnostics rather than committed wrong
