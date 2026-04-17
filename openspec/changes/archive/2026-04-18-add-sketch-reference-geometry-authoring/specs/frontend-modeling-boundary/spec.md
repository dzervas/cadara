## ADDED Requirements

### Requirement: Sketch reference mutations SHALL preserve frontend and modeling ownership
The system SHALL keep transient sketch reference picking and preview state in the frontend editor layer and SHALL route accepted durable sketch reference changes through the frontend-facing modeling boundary.

#### Scenario: Reference picking is in progress
- **WHEN** the user is selecting external geometry to reference from an active sketch
- **THEN** hover, preview, and target-collection state remains editor-owned and is not written directly to the durable document

#### Scenario: Reference is accepted
- **WHEN** the user accepts an external reference for an active sketch
- **THEN** the accepted reference mutation is committed through the modeling boundary rather than written directly by a React component or viewport renderer

#### Scenario: Reference is removed
- **WHEN** the user removes an authored external sketch reference
- **THEN** the removal is routed through the modeling boundary and updates the authoritative sketch definition
