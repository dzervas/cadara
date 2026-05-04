## MODIFIED Requirements

### Requirement: Authored SVG sketch styles SHALL render consistently
The system SHALL render supported authored local sketch style fields in active sketch display and after sketch commit/re-entry when SVG rendering is enabled for that sketch, SHALL suppress those viewport visual effects when SVG rendering is disabled without dropping style data, and SHALL serialize supported authored style fields into SVG sketch exports.

#### Scenario: Styled sketch is reopened with SVG rendering enabled
- **WHEN** a sketch with local fill or stroke styles is committed and reopened with SVG rendering enabled
- **THEN** the visible sketch geometry uses the persisted style values supported by the viewport renderer

#### Scenario: Styled sketch is reopened with SVG rendering disabled
- **WHEN** a sketch with local fill or stroke styles is committed and reopened with SVG rendering disabled
- **THEN** the visible sketch geometry uses the normal sketch rendering treatment without authored SVG fill or stroke effects
- **AND** the persisted style values remain available if SVG rendering is enabled later

#### Scenario: Styled sketch is exported as SVG
- **WHEN** a committed sketch with local fill or stroke styles is exported as SVG
- **THEN** the exported SVG serializes the supported authored fill and stroke style values
- **AND** the export does not depend on transient viewport material state

#### Scenario: Unsupported style rendering is encountered
- **WHEN** an authored style field cannot be rendered by the current viewport material path
- **THEN** the style data remains persisted and the viewport uses a documented fallback without dropping the sketch session

#### Scenario: Unsupported style export is encountered
- **WHEN** an authored style field cannot be serialized by the current SVG export path
- **THEN** the style data remains persisted
- **AND** SVG export uses a documented fallback and reports a diagnostic for the unsupported style field
