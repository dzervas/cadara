## ADDED Requirements

### Requirement: Trim and offset sketch mutations SHALL preserve frontend and modeling ownership
The system SHALL keep transient Trim and Offset selection, preview, and validation state in the frontend editor layer while routing accepted durable sketch definition changes through the frontend-facing modeling boundary.

#### Scenario: Trim preview is in progress
- **WHEN** the user previews a trim operation before accepting it
- **THEN** the transient preview remains editor-owned and is not written directly to the durable document by a React component

#### Scenario: Offset is accepted
- **WHEN** the user accepts a valid offset operation
- **THEN** the accepted sketch definition change is committed through the modeling boundary
