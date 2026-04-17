## ADDED Requirements

### Requirement: Existing sketch geometry SHALL support construction toggling
The system SHALL allow users editing a sketch to toggle supported selected sketch vertices/points and edges/entities between normal and construction geometry.

#### Scenario: User toggles a normal edge to construction
- **WHEN** the user activates Construction while editing a sketch and selects a normal supported sketch edge or entity
- **THEN** the editor prepares an authored sketch mutation that sets the selected entity `isConstruction` flag to true

#### Scenario: User toggles a construction edge to normal
- **WHEN** the user activates Construction while editing a sketch and selects a supported sketch edge or entity whose `isConstruction` flag is true
- **THEN** the editor prepares an authored sketch mutation that sets the selected entity `isConstruction` flag to false

#### Scenario: User toggles a normal vertex to construction
- **WHEN** the user activates Construction while editing a sketch and selects a normal supported sketch vertex or point
- **THEN** the editor prepares an authored sketch mutation that marks the selected point or point entity construction-only

#### Scenario: User toggles a construction vertex to normal
- **WHEN** the user activates Construction while editing a sketch and selects a supported sketch vertex or point whose authored construction flag is true
- **THEN** the editor prepares an authored sketch mutation that marks the selected point or point entity normal

### Requirement: Construction edge toggles SHALL not mutate unrelated shared points
The system MUST NOT automatically toggle endpoint point records when toggling an edge or curve entity to or from construction unless the selected target itself is that point.

#### Scenario: Edge shares endpoints with normal geometry
- **WHEN** the user toggles a sketch edge that shares one or more endpoint records with normal sketch geometry
- **THEN** only the selected edge entity construction flag changes
- **AND** the shared endpoint point records keep their previous construction flags

### Requirement: Construction toggle interactions SHALL preserve direct edit behavior
The system SHALL keep construction toggling separate from drag editing so Construction target picks do not start direct drag updates.

#### Scenario: Construction target pick does not start drag editing
- **WHEN** the user activates Construction and clicks a supported sketch edge or vertex
- **THEN** the editor toggles construction status for the selected target
- **AND** the editor does not enter a geometry drag state for that click

#### Scenario: Direct edit still works after construction toggle
- **WHEN** the user finishes toggling a sketch target with Construction and then selects the same target without Construction active
- **THEN** the existing direct selection and drag editing behavior remains available for that target
