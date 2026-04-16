## ADDED Requirements

### Requirement: The left workbench sidebar SHALL be resizable
The workbench SHALL provide a drag handle that lets the user resize the left sidebar within bounded minimum and maximum widths.

#### Scenario: Drag the left sidebar wider
- **WHEN** the user drags the left sidebar resize handle to the right within allowed bounds
- **THEN** the sidebar width increases and the viewport width updates to the remaining available space

#### Scenario: Drag the left sidebar narrower
- **WHEN** the user drags the left sidebar resize handle to the left within allowed bounds
- **THEN** the sidebar width decreases without collapsing below its minimum allowed width

### Requirement: The right inspector SHALL overlay the viewport
The workbench SHALL render the right inspector as an overlay panel within the workbench frame instead of expanding page layout or requiring document-level scroll to view it.

#### Scenario: Open the right inspector
- **WHEN** the user opens the right inspector
- **THEN** the inspector appears over the viewport area and the document page does not expand to accommodate it

#### Scenario: Inspector content exceeds panel height
- **WHEN** the right inspector contains more content than fits vertically in its panel
- **THEN** the inspector panel scrolls internally while the surrounding page layout remains fixed
