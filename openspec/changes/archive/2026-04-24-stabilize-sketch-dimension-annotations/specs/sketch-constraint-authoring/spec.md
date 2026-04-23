## ADDED Requirements

### Requirement: Committed dimensions SHALL present compact dimension annotations
The system SHALL render committed dimensions as dimension-specific annotations whose visible chip content is a compact dimension glyph plus the authored measurement value rather than a verbose constraint-style badge label.

#### Scenario: Committed rectangle dimension is shown in the viewport
- **WHEN** the active sketch contains a committed width, height, radius, diameter, distance, or angle dimension
- **THEN** the viewport shows that committed dimension as a compact dimension annotation chip
- **AND** the chip's visible text is the measurement value for that dimension
- **AND** the chip does not render verbose text such as the sketch entity label or dimensional role as part of the visible annotation content

#### Scenario: Compact dimension annotation preserves accessible detail
- **WHEN** the viewport renders a committed compact dimension annotation
- **THEN** the annotation still preserves descriptive label/detail text for accessibility, diagnostics, and tooltip metadata
- **AND** reducing the visible text to a compact value does not remove the durable annotation's editability or identity

### Requirement: Committed dimension annotations SHALL support direct editing from the annotation chip
The system SHALL treat the committed dimension annotation chip itself as the durable edit affordance for that dimension.

#### Scenario: User double-clicks a committed dimension annotation
- **WHEN** the user double-clicks a committed dimension annotation chip
- **THEN** the editor reopens the floating numeric input for that durable dimension
- **AND** the reopened input is seeded from the current committed dimension value

#### Scenario: User commits an edit from a reopened dimension annotation
- **WHEN** the user edits the reopened committed dimension value and accepts it
- **THEN** the durable dimension record is updated with the new value
- **AND** the committed dimension annotation continues to represent the same durable dimension target

