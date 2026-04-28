## ADDED Requirements

### Requirement: Reference-image calibration mode SHALL author anchor bindings into the flat sketch graph
The reference-image calibration special mode SHALL place and manage reference-image anchor bindings by creating or selecting ordinary local sketch points in the active flat sketch graph while persisting the image-relative `u/v` coordinates for each anchor on the targeted reference-image operation.

#### Scenario: User places a new image anchor
- **WHEN** the user clicks the active reference image while calibration mode is open
- **THEN** the mode creates or reuses a local construction point at the clicked sketch position
- **AND** the targeted reference-image operation records a new anchor binding that stores the clicked `u/v` coordinates and the bound local point id

#### Scenario: User removes an existing image anchor
- **WHEN** the user removes an anchor from the calibration panel or viewport while calibration mode is open
- **THEN** the targeted reference-image operation removes that anchor binding
- **AND** the mode cleans up or detaches the corresponding local point according to the documented binding-ownership rules

### Requirement: Reference-image calibration mode SHALL hand geometric solving back to ordinary sketch editing
The reference-image calibration special mode SHALL be limited to anchor placement, rebinding, selection, and metadata edits, and SHALL NOT expose or own a calibration-specific geometric constraint workflow.

#### Scenario: User finishes placing anchors
- **WHEN** the user commits or exits reference-image calibration mode after placing anchors
- **THEN** the editor returns to ordinary sketch editing with the bound anchor points still present in the flat sketch graph
- **AND** subsequent geometric constraints and dimensions are authored through the normal sketch workflow instead of through calibration mode
