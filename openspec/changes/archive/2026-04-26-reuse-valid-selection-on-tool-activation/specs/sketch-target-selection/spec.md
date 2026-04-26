## MODIFIED Requirements

### Requirement: Selecting a valid planar target opens sketch mode
The system MUST open a sketch session on the selected planar target after the user activates `Sketch` and either reuses a valid preselected target or selects a valid target from the viewport or feature tree. If the current selection is incompatible with sketch start rules, the system MUST clear that selection and remain in sketch-start target collection.

#### Scenario: Start sketch from the viewport
- **WHEN** the user activates `Sketch` and selects a valid planar target in the viewport
- **THEN** the editor opens a sketch session on that selected target

#### Scenario: Start sketch from the feature tree
- **WHEN** the user activates `Sketch` and selects a valid planar target from the feature tree
- **THEN** the editor opens a sketch session on that selected target

#### Scenario: Start sketch from a valid preselected planar target
- **WHEN** the user activates `Sketch` while exactly one valid planar sketch target is already selected
- **THEN** the editor opens a sketch session on that preselected target without requiring a second selection click

#### Scenario: Incompatible preselection is cleared for sketch start
- **WHEN** the user activates `Sketch` while the current selection contains unsupported targets or more than one target
- **THEN** the editor clears the current selection
- **AND** it remains in the sketch-start target-picking workflow until the user selects one valid target
