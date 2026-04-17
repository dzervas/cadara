## ADDED Requirements

### Requirement: Construction geometry mutations SHALL preserve frontend/modeling ownership
The system SHALL keep transient construction tool state in the frontend editor layer and SHALL route accepted construction flag changes through the frontend-facing modeling service boundary.

#### Scenario: Construction modifier changes before commit
- **WHEN** the user activates or deactivates construction authoring context during sketch editing
- **THEN** that transient modifier state remains editor-owned and is not written directly to the durable document

#### Scenario: Existing geometry construction toggle is accepted
- **WHEN** the user toggles an existing sketch point or entity to or from construction status
- **THEN** the accepted authored sketch definition change is committed through the modeling service boundary

#### Scenario: New construction geometry is committed
- **WHEN** a drawing tool creates geometry while construction authoring context is active
- **THEN** the accepted sketch commit containing construction flags is routed through the modeling service boundary
