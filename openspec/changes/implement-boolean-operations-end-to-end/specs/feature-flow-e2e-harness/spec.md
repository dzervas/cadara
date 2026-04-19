## MODIFIED Requirements

### Requirement: Supported feature flows SHALL have Playwright coverage
The system SHALL include Playwright e2e coverage for extrude, revolve, fillet, shell, plane, and Combine boolean feature flows through the workbench UI, including assertions that committed boolean geometry visibly changes and survives rebuild.

#### Scenario: Extrude remains covered
- **WHEN** the e2e suite runs the extrude feature flow
- **THEN** a valid sketch profile can be selected, previewed, and committed without runtime errors or failed diagnostics

#### Scenario: Revolve is covered
- **WHEN** the e2e suite runs the revolve feature flow with a valid profile and durable edge-backed axis
- **THEN** the feature can be previewed and committed without runtime errors or failed diagnostics

#### Scenario: Fillet is covered
- **WHEN** the e2e suite runs the fillet feature flow against one or more durable body edges
- **THEN** the edges are selectable in the viewport and the feature can be previewed and committed without runtime errors or failed diagnostics

#### Scenario: Shell is covered
- **WHEN** the e2e suite runs the shell feature flow against a valid body and removable face
- **THEN** the feature can be previewed and committed without runtime errors or failed diagnostics

#### Scenario: Plane is covered
- **WHEN** the e2e suite runs the plane feature flow from a supported construction plane or planar face reference
- **THEN** the construction plane feature can be previewed and committed without runtime errors or failed diagnostics

#### Scenario: Boolean is covered
- **WHEN** the e2e suite runs a Combine boolean feature flow with deterministic target bodies, tool bodies, and explicit operation intent
- **THEN** the Combine operation can be previewed and committed without runtime errors or failed diagnostics
- **AND** the viewport or generated snapshot demonstrates that committed geometry changed from the pre-combine body set
- **AND** refreshing or rebuilding the document preserves the committed Combine result
