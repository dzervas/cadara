## ADDED Requirements

### Requirement: Transient sketch tool geometry SHALL stay separate from accepted sketch geometry
The viewport SHALL render transient active-tool sketch geometry from explicit staged tool state and SHALL render accepted sketch geometry from the active sketch definition.

#### Scenario: Tool preview is shown while active
- **WHEN** an active sketch tool provides transient staged geometry
- **THEN** the viewport renders that staged geometry together with accepted definition-derived sketch geometry
- **AND** the staged geometry is not written into the accepted sketch entity source of truth until accepted through the sketch tool flow

#### Scenario: Tool preview is cleared after tool exit
- **WHEN** the active sketch tool is cancelled, finished, or replaced by another tool
- **THEN** transient staged geometry from the prior tool is removed from the viewport
- **AND** accepted definition-derived geometry remains visible

#### Scenario: Accepted entity changes while preview state exists
- **WHEN** accepted sketch definition geometry changes while transient staged geometry is present
- **THEN** the viewport derives accepted renderables from the updated sketch definition
- **AND** it keeps only the current staged tool geometry as transient authoring feedback
