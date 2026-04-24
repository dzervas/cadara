## ADDED Requirements

### Requirement: Connected sketch geometry SHALL be selectable by double-click
The system SHALL allow users editing a sketch to double-click an editable local sketch entity and select every editable local sketch entity in the same connected component. Connectivity SHALL be derived from shared sketch point records in the active sketch definition.

#### Scenario: User double-clicks one of two connected lines
- **WHEN** the user is editing a sketch containing two editable local line entities that share an endpoint point record
- **AND** the user double-clicks either line entity in the viewport
- **THEN** the editor selects both line entities
- **AND** the active sketch session remains open

#### Scenario: User double-clicks one edge of a rectangle
- **WHEN** the user is editing a sketch containing a rectangle represented by four editable local line entities connected through shared corner point records
- **AND** the user double-clicks any one rectangle edge in the viewport
- **THEN** the editor selects all four rectangle edge entities
- **AND** the selection is based on graph connectivity rather than rectangle authoring operation metadata

#### Scenario: Branching connected geometry is selected as one component
- **WHEN** the user is editing a sketch containing editable local entities that form a branching connected component through shared point records
- **AND** the user double-clicks any entity in that component
- **THEN** the editor selects every editable local entity reachable through the shared point graph

#### Scenario: Projected reference geometry is not expanded
- **WHEN** the user is editing a sketch and double-clicks projected reference geometry
- **THEN** the editor does not add connected local sketch entities through the connected-geometry selection path
- **AND** projected reference geometry keeps its existing read-only selection behavior
