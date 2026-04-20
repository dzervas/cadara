## ADDED Requirements

### Requirement: Sketch transform operators SHALL be available in sketch mode
The system SHALL expose sketch-mode mirror, linear pattern, circular pattern, and transform operators while keeping them distinct from part-mode feature tools with similar names.

#### Scenario: User activates sketch mirror
- **WHEN** the user activates Mirror while editing a sketch
- **THEN** the active sketch session remains open
- **AND** the editor enters a sketch-local mirror selection and preview workflow

#### Scenario: User activates sketch pattern or transform
- **WHEN** the user activates Linear Pattern, Circular Pattern, or Transform while editing a sketch
- **THEN** the active sketch session remains open
- **AND** the editor enters the selected operator's sketch-local workflow

### Requirement: Derived sketch operators SHALL create durable referenced relationships
Sketch mirror, pattern, and transform operators MUST create durable referenced and related geometry rather than one-time static copies.

#### Scenario: Mirror relationship is committed
- **WHEN** the user mirrors supported sketch geometry across a supported sketch reference
- **THEN** the sketch definition preserves the selected seed geometry, mirror reference, and derived mirrored geometry relationship

#### Scenario: Pattern relationship is committed
- **WHEN** the user creates a supported linear or circular pattern from selected sketch geometry
- **THEN** the sketch definition preserves the selected seed geometry, pattern parameters, and derived instance relationships

#### Scenario: Transform relationship is committed
- **WHEN** the user transforms supported sketch geometry with valid transform parameters
- **THEN** the sketch definition preserves the selected seed geometry, transform parameters, and derived transformed geometry relationship

### Requirement: Derived geometry SHALL update from supported seed edits
The system SHALL update or preserve supported derived sketch geometry relationships when the seed geometry or transform parameters change.

#### Scenario: Seed geometry changes
- **WHEN** a user edits supported seed geometry used by a mirror, pattern, or transform relationship
- **THEN** the derived geometry updates according to the durable relationship
- **AND** the relationship remains represented in the authored sketch graph

#### Scenario: Derived relationship cannot be maintained
- **WHEN** a seed edit or parameter edit makes a derived relationship unsupported or unsatisfiable
- **THEN** the system reports a structured diagnostic
- **AND** it does not silently convert derived geometry into detached static copies

### Requirement: Derived geometry SHALL participate in sketch workflows where supported
Derived mirror, pattern, and transform geometry SHALL be renderable, selectable, persistable, and profile-capable where the derived relationship can be resolved.

#### Scenario: Derived geometry is visible and selectable
- **WHEN** a sketch contains a resolved derived geometry relationship
- **THEN** the viewport displays the derived geometry
- **AND** supported derived targets can be selected through stable sketch target identities

#### Scenario: Derived profile is available
- **WHEN** resolved derived geometry forms a supported closed profile
- **THEN** profile extraction exposes selectable derived profile regions for downstream feature authoring
