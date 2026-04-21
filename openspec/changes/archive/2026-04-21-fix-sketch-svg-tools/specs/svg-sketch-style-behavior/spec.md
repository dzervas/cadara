## ADDED Requirements

### Requirement: SVG sketch rendering SHALL be toggleable per sketch
The system SHALL provide a sketch-owned SVG rendering setting that enables or disables authored fill and stroke rendering for that sketch without deleting authored style data.

#### Scenario: User disables SVG rendering for a sketch
- **WHEN** the user turns SVG rendering off while editing a sketch with authored fill or stroke styles
- **THEN** the active sketch viewport omits the authored fill and stroke visual effects
- **AND** the sketch's authored style data remains stored in the document

#### Scenario: User re-enables SVG rendering for a sketch
- **WHEN** the user turns SVG rendering back on for the same sketch
- **THEN** the active sketch viewport renders the sketch's existing authored fill and stroke styles again

#### Scenario: SVG rendering setting survives reopening
- **WHEN** a sketch's SVG rendering setting is saved, committed, and reopened
- **THEN** the reopened sketch uses that saved setting instead of a global default from another sketch

## MODIFIED Requirements

### Requirement: SVG style tools SHALL open focused sketch style controls
The system SHALL make explicit Fill and Stroke toolbar activations open the relevant style controls for compatible active-sketch targets while preserving the active sketch session. The system MUST NOT open or focus Fill or Stroke controls merely because the user enters sketch mode, edits sketch geometry, changes selection, or causes live regions to recalculate.

#### Scenario: User activates Fill with a selected region
- **WHEN** the user selects a supported enclosed region in the active sketch and activates `fill`
- **THEN** the sketch UI shows fill-related controls for that region target
- **AND** the editor remains in sketch editing mode

#### Scenario: User activates Stroke with a selected edge
- **WHEN** the user selects a supported local sketch edge and activates `stroke`
- **THEN** the sketch UI shows stroke-related controls for that edge target
- **AND** the editor remains in sketch editing mode

#### Scenario: User activates style tool without a compatible target
- **WHEN** the user activates `fill` without a selected enclosed region or activates `stroke` without a selected sketch edge
- **THEN** the editor remains in sketch editing mode and shows target-selection guidance for the requested tool
- **AND** the sketch draft is not mutated

#### Scenario: Sketch editing recalculates regions
- **WHEN** the user is editing a sketch and live enclosed regions are recalculated
- **THEN** the Fill controls do not open or become focused unless the user explicitly activates `fill`

### Requirement: SVG style controls SHALL patch authored local sketch styles
The system SHALL apply Fill control changes to selected enclosed region style data and Stroke control changes to selected local sketch edge style data as authored sketch style data.

#### Scenario: User changes stroke width
- **WHEN** the user changes stroke width for a selected sketch edge through the Stroke form
- **THEN** the sketch draft stores the updated stroke width on that edge style
- **AND** the sketch commit request includes the updated style

#### Scenario: User changes fill type
- **WHEN** the user selects solid or gradient fill for a selected enclosed region through the Fill form
- **THEN** the sketch draft stores the selected fill mode and related color values for that region style

#### Scenario: Fill rejects non-region targets
- **WHEN** the Fill form receives a selected point, edge, or non-region target
- **THEN** the sketch draft is not mutated
- **AND** the UI continues to request an enclosed region target

#### Scenario: Stroke rejects region targets
- **WHEN** the Stroke form receives a selected enclosed region target
- **THEN** the sketch draft is not mutated
- **AND** the UI continues to request a sketch edge target

### Requirement: Authored SVG sketch styles SHALL render consistently
The system SHALL render supported authored local sketch style fields in active sketch display and after sketch commit/re-entry when SVG rendering is enabled for that sketch, and SHALL suppress those visual effects when SVG rendering is disabled without dropping style data.

#### Scenario: Styled sketch is reopened with SVG rendering enabled
- **WHEN** a sketch with local fill or stroke styles is committed and reopened with SVG rendering enabled
- **THEN** the visible sketch geometry uses the persisted style values supported by the viewport renderer

#### Scenario: Styled sketch is reopened with SVG rendering disabled
- **WHEN** a sketch with local fill or stroke styles is committed and reopened with SVG rendering disabled
- **THEN** the visible sketch geometry uses the normal sketch rendering treatment without authored SVG fill or stroke effects
- **AND** the persisted style values remain available if SVG rendering is enabled later

#### Scenario: Unsupported style rendering is encountered
- **WHEN** an authored style field cannot be rendered by the current viewport material path
- **THEN** the style data remains persisted and the viewport uses a documented fallback without dropping the sketch session
