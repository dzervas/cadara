## ADDED Requirements

### Requirement: Constraint authoring SHALL preview the pending geometric reference
The system SHALL show transient viewport preview geometry for active dimensional and angular constraint operations before committing durable constraint records.

#### Scenario: Dimension preview is active
- **WHEN** the user has selected enough targets to preview a dimensional constraint
- **THEN** the viewport shows a thin transient dimension reference that indicates what geometry the dimension will constrain

#### Scenario: Angle preview is active
- **WHEN** the user has selected enough line or point references to preview an angle constraint
- **THEN** the viewport shows a transient arc between the affected references

### Requirement: Dimensional constraints SHALL disambiguate reference direction from pointer position
The system SHALL allow dimensional constraint authoring to choose among available reference directions, such as diagonal, horizontal, and vertical distance, based on pointer position near the implied dimension reference.

#### Scenario: Point-to-point dimension changes reference mode
- **WHEN** a dimension between two points could represent diagonal, horizontal, or vertical distance
- **THEN** moving the pointer near each implied reference line updates the preview to the corresponding dimension reference before commit

### Requirement: Constraint value entry SHALL appear near the active preview
The system SHALL render value-entry input for dimensional or angular constraints near the active mouse position or preview reference in the viewport.

#### Scenario: Dimension value is requested
- **WHEN** a dimensional constraint has selected its required targets and needs an authored value
- **THEN** the numeric input appears near the active preview reference rather than in a detached feature-editor-style panel
