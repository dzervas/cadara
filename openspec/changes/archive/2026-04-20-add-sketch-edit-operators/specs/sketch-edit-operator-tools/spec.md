## ADDED Requirements

### Requirement: Sketch edit operators SHALL be available in sketch mode
The system SHALL expose sketch-mode edit tools for fillet, chamfer, extend, split, and slot while keeping them distinct from similarly named part-mode feature tools.

#### Scenario: User activates a sketch edit operator
- **WHEN** the user activates fillet, chamfer, extend, split, or slot while editing a sketch
- **THEN** the active sketch session remains open
- **AND** the editor enters the operator's sketch-local selection and preview workflow

### Requirement: Sketch edit operators SHALL validate supported targets before mutation
Sketch edit operators SHALL mutate only supported editable local sketch geometry and SHALL report validation feedback for unsupported targets or unsafe operations.

#### Scenario: Unsupported edit target is selected
- **WHEN** the active sketch edit operator receives a target it cannot mutate safely
- **THEN** the sketch definition remains unchanged
- **AND** the editor reports validation feedback for the unsupported target

### Requirement: Fillet and chamfer SHALL create durable sketch corner geometry
Sketch fillet and chamfer operators SHALL replace supported sharp sketch corners with durable curve or line geometry that preserves the selected edit intent where possible.

#### Scenario: Sketch fillet is accepted
- **WHEN** the user accepts a valid sketch fillet on supported adjacent curves
- **THEN** the affected sketch geometry is updated through sketch-session domain logic
- **AND** the fillet curve is represented as durable sketch geometry

#### Scenario: Sketch chamfer is accepted
- **WHEN** the user accepts a valid sketch chamfer on supported adjacent curves
- **THEN** the affected sketch geometry is updated through sketch-session domain logic
- **AND** the chamfer segment is represented as durable sketch geometry

### Requirement: Extend and split SHALL preserve unrelated geometry
Sketch extend and split operators SHALL update only the selected supported geometry and SHALL preserve unrelated sketch entities, constraints, dimensions, and styles where possible.

#### Scenario: Sketch extend is accepted
- **WHEN** the user extends a supported curve to a supported boundary
- **THEN** only the selected curve's authored geometry changes
- **AND** unrelated sketch geometry remains unchanged

#### Scenario: Sketch split is accepted
- **WHEN** the user splits a supported curve at a valid split point
- **THEN** the selected curve is replaced or divided by sketch-session domain logic
- **AND** unrelated sketch geometry remains unchanged

### Requirement: Slot SHALL create durable geometry around selected sketch references
The slot tool SHALL create durable slot geometry around a selected line, spline, arc, or closed profile.

#### Scenario: Slot around selected line is accepted
- **WHEN** the user selects a supported line and accepts a valid slot size
- **THEN** the sketch contains durable slot boundary geometry related to the selected line

#### Scenario: Slot around selected curve or profile is accepted
- **WHEN** the user selects a supported spline, arc, or closed profile and accepts a valid slot size
- **THEN** the sketch contains durable slot boundary geometry related to the selected reference

#### Scenario: Slot target is unsupported
- **WHEN** the selected geometry cannot define a valid slot
- **THEN** the sketch definition remains unchanged
- **AND** the editor reports validation feedback
