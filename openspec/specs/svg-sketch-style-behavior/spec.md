# svg-sketch-style-behavior Specification

## Purpose
TBD - created by archiving change implement-svg-sketch-style-behavior. Update Purpose after archive.
## Requirements
### Requirement: SVG style tools SHALL open focused sketch style controls
The system SHALL make SVG/style toolbar commands open the relevant style controls for a selected local sketch point or entity while preserving the active sketch session.

#### Scenario: User activates Fill with a selected entity
- **WHEN** the user selects a supported local sketch entity and activates `fill`
- **THEN** the sketch UI shows fill-related controls for that target
- **AND** the editor remains in sketch editing mode

#### Scenario: User activates style tool without a target
- **WHEN** the user activates a style tool without a supported sketch style target selected
- **THEN** the editor remains in sketch editing mode and shows target-selection guidance without mutating the sketch draft

### Requirement: SVG style controls SHALL patch authored local sketch styles
The system SHALL apply fill and stroke control changes to the selected local sketch point or entity as authored sketch style data.

#### Scenario: User changes stroke width
- **WHEN** the user changes stroke width for a selected sketch entity
- **THEN** the sketch draft stores the updated stroke width on that entity style
- **AND** the sketch commit request includes the updated style

#### Scenario: User changes fill type
- **WHEN** the user selects solid or gradient fill for a selected sketch entity
- **THEN** the sketch draft stores the selected fill mode and related color values

### Requirement: Authored SVG sketch styles SHALL render consistently
The system SHALL render supported authored local sketch style fields in active sketch display and after sketch commit/re-entry.

#### Scenario: Styled sketch is reopened
- **WHEN** a sketch with local fill or stroke styles is committed and reopened
- **THEN** the visible sketch geometry uses the persisted style values supported by the viewport renderer

#### Scenario: Unsupported style rendering is encountered
- **WHEN** an authored style field cannot be rendered by the current viewport material path
- **THEN** the style data remains persisted and the viewport uses a documented fallback without dropping the sketch session

