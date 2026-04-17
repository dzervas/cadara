## ADDED Requirements

### Requirement: Committed annotation deletion SHALL route through durable modeling actions
The system SHALL delete committed sketch constraint and dimension annotations through durable modeling actions rather than by removing viewport-only glyph state.

#### Scenario: User deletes a committed constraint glyph
- **WHEN** the editor receives a delete request for a selected committed constraint or dimension annotation
- **THEN** the deletion resolves to a durable sketch mutation through the modeling service boundary
