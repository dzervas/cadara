## ADDED Requirements

### Requirement: Sketch construction geometry SHALL be authored as construction-only metadata
The system SHALL represent construction status on authored sketch point and entity records and MUST preserve the original geometry kind when construction status changes.

#### Scenario: Normal sketch entity becomes construction
- **WHEN** a user toggles a normal authored sketch edge or curve to construction
- **THEN** the authored entity remains the same geometric kind with `isConstruction` set to true

#### Scenario: Construction sketch entity becomes normal
- **WHEN** a user toggles an authored sketch edge or curve that already has `isConstruction` set to true
- **THEN** the authored entity remains the same geometric kind with `isConstruction` set to false

#### Scenario: Sketch vertex becomes construction
- **WHEN** a user toggles a supported authored sketch vertex or point to construction
- **THEN** the authored point or point entity records associated with that target are marked construction without changing unrelated entities

### Requirement: Construction geometry SHALL be excluded from profile creation
The system MUST NOT use construction-only sketch entities as profile or region boundaries.

#### Scenario: Construction edge crosses a closed profile
- **WHEN** a sketch contains a normal closed profile and a construction edge crossing that profile
- **THEN** profile creation uses only the normal boundary geometry
- **AND** the construction edge does not split or remove the profile

#### Scenario: Closed construction geometry exists by itself
- **WHEN** a sketch contains a closed loop or circle whose boundary entities are construction-only
- **THEN** profile creation does not create a selectable profile region from that construction-only loop

### Requirement: Construction geometry SHALL remain editable while editing the owning sketch
The system SHALL allow construction sketch geometry to be selected, edited, constrained, and toggled while the owning sketch is in edit mode.

#### Scenario: Construction edge is selected during sketch editing
- **WHEN** the user is editing a sketch and clicks a construction edge accepted by the current sketch interaction context
- **THEN** the viewport resolves that edge as a sketch selection target

#### Scenario: Construction geometry participates in constraints
- **WHEN** a constraint authoring operation accepts a supported construction vertex or edge during sketch editing
- **THEN** the operation can use that construction target as a constraint participant

### Requirement: Construction geometry SHALL only render during sketch editing
The system SHALL hide construction-only sketch geometry when the owning sketch is not being edited and SHALL render it during sketch editing.

#### Scenario: Sketch is not being edited
- **WHEN** the viewport renders a document snapshot outside an active edit session for a sketch containing construction geometry
- **THEN** construction-only sketch geometry from that sketch is not rendered

#### Scenario: Sketch is being edited
- **WHEN** the viewport renders an active sketch editing session for a sketch containing construction geometry
- **THEN** construction-only sketch geometry from that sketch is rendered as editable sketch feedback

### Requirement: Construction geometry SHALL use dashed wire styling while visible
The system SHALL render visible construction sketch geometry with dashed wire styling that is distinct from normal profile-producing sketch geometry.

#### Scenario: Construction line is rendered during sketch editing
- **WHEN** a construction line is visible in an active sketch editing session
- **THEN** it is rendered with a dashed line treatment

#### Scenario: Construction circle is rendered during sketch editing
- **WHEN** a construction circle is visible in an active sketch editing session
- **THEN** it is rendered with a dashed curve treatment
