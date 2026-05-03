# sketch-plane-reassignment Specification

## Purpose
TBD - created by archiving change change-sketch-plane-from-context-menus. Update Purpose after archive.
## Requirements
### Requirement: Committed sketches with supported support targets SHALL support dedicated plane reassignment
The system SHALL allow a committed sketch whose stored support resolves to a construction plane or planar face to enter a dedicated sketch-plane edit flow that is distinct from normal sketch authoring reopen.

#### Scenario: Open plane reassignment from Parts & Objects
- **WHEN** the user selects `Change Sketch Plane` from the context menu of an eligible committed sketch row in `Parts & Objects`
- **THEN** the workbench opens a dedicated sketch-plane edit session for that sketch
- **AND** it does not reopen the full sketch authoring session

#### Scenario: Open plane reassignment from the history bar
- **WHEN** the user selects `Change Sketch Plane` from the context menu of an eligible committed sketch item in the bottom history bar
- **THEN** the workbench opens the same dedicated sketch-plane edit session for that sketch
- **AND** it uses the same committed-item rollback lifecycle as other committed edit flows when rollback is required

### Requirement: Sketch-plane edit sessions SHALL expose support-plane picking
The dedicated sketch-plane edit flow SHALL render through the inspector surface and SHALL expose the current committed support plane through the shared single-target plane picker so the user can retarget the sketch to another construction plane or planar face.

#### Scenario: Current support is preselected
- **WHEN** an eligible committed sketch enters the sketch-plane edit session
- **THEN** the inspector shows the sketch's current committed support target as the selected value
- **AND** the user can pick another construction plane or planar face without entering sketch mode

#### Scenario: Unsupported sketch does not expose reassignment
- **WHEN** a committed sketch does not participate in the support-plane reassignment capability
- **THEN** the workbench does not expose `Change Sketch Plane` as an enabled context-menu action for that sketch

### Requirement: Accepted sketch-plane reassignment SHALL recommit the sketch on the new plane
When the user accepts a changed support plane, the system SHALL persist the committed sketch with its existing authored sketch definition and label but with the newly selected plane, then refresh the document from the accepted result.

#### Scenario: Commit an updated support plane
- **WHEN** the user changes the selected support plane in the sketch-plane edit session and commits
- **THEN** the workbench recommits that sketch using the newly selected plane
- **AND** the refreshed committed sketch stores the new plane definition
- **AND** later authored history rebuilds from the accepted document result

#### Scenario: Cancel plane reassignment
- **WHEN** the user cancels the sketch-plane edit session
- **THEN** the committed sketch remains on its original plane
- **AND** the workbench exits the dedicated sketch-plane edit flow without applying a sketch recommit

