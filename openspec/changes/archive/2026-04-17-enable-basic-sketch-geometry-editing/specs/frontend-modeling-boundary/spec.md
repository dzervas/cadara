## ADDED Requirements

### Requirement: Direct sketch edits SHALL preserve editor and modeling boundary ownership
The system SHALL keep in-progress direct sketch drag state in the editor layer while routing accepted authored sketch changes through the frontend-facing modeling service boundary.

#### Scenario: User previews a sketch drag
- **WHEN** the user is dragging sketch geometry before accepting or completing the edit
- **THEN** the transient pointer state and preview remain editor-owned and are not written directly to the durable document by a React component

#### Scenario: User completes a valid sketch drag
- **WHEN** the user completes a valid direct sketch edit
- **THEN** the accepted authored sketch definition change is committed through the modeling service boundary
