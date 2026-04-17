## ADDED Requirements

### Requirement: Sketch tool commits SHALL honor construction authoring context
Sketch drawing tool definitions SHALL receive construction authoring context when producing commit contributions and SHALL mark newly authored geometry construction-only when that context is active.

#### Scenario: Drawing tool commits normal geometry
- **WHEN** a sketch drawing tool completes while construction authoring context is inactive
- **THEN** the committed points and entities are authored with `isConstruction` set to false

#### Scenario: Drawing tool commits construction geometry
- **WHEN** a sketch drawing tool completes while construction authoring context is active
- **THEN** the committed points and entities created by that tool are authored with `isConstruction` set to true

#### Scenario: Future drawing tool uses shared commit context
- **WHEN** a new sketch drawing tool is registered
- **THEN** it can author construction geometry through the shared sketch tool commit context without adding a duplicate construction-specific tool definition

### Requirement: The Construction toolbar tool SHALL act as a sketch authoring modifier
The system SHALL expose Construction as a sketch-mode tool that can remain selected as a modifier while another sketch drawing tool is active.

#### Scenario: Construction is picked before a drawing tool
- **WHEN** the user activates Construction and then activates a sketch drawing tool before selecting viewport geometry
- **THEN** Construction remains selected as an active modifier
- **AND** the drawing tool becomes the active geometry creation tool

#### Scenario: Construction modifier is toggled off
- **WHEN** Construction is selected as an active modifier and the user activates Construction again
- **THEN** construction authoring context becomes inactive
- **AND** subsequent drawing tool commits create normal geometry

#### Scenario: Sketch editing ends
- **WHEN** an active sketch editing session ends
- **THEN** construction authoring context is cleared
