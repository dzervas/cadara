## ADDED Requirements

### Requirement: Committed constraints SHALL render as viewport-local annotation glyphs
The system SHALL render committed sketch constraints and dimensions as small viewport-local glyphs near the sketch geometry they affect.

#### Scenario: Sketch contains committed constraints
- **WHEN** a sketch with committed constraints or dimensions is visible in the viewport
- **THEN** each supported committed annotation appears as a small glyph or dimension marker near its affected geometry

### Requirement: Annotation glyph interaction SHALL highlight affected geometry without selecting it
The system SHALL highlight geometry affected by a committed annotation when the annotation glyph is hovered or selected, while keeping the annotation itself as the selected target.

#### Scenario: User hovers an annotation glyph
- **WHEN** the user hovers a committed constraint or dimension glyph
- **THEN** the affected sketch geometry is highlighted and the geometry is not selected

#### Scenario: User selects an annotation glyph
- **WHEN** the user clicks a committed constraint or dimension glyph
- **THEN** the editor selects the annotation target and highlights the affected geometry

### Requirement: Selected annotation deletion SHALL remove the durable constraint record
The system SHALL remove the selected committed constraint or dimension when the user invokes Delete or Backspace on the selected annotation target.

#### Scenario: User deletes a selected annotation
- **WHEN** a committed constraint or dimension annotation is selected and the user presses Delete or Backspace
- **THEN** the corresponding durable sketch constraint or dimension record is removed through the editor/modeling mutation flow
