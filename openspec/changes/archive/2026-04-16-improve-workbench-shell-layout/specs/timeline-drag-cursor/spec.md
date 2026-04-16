## ADDED Requirements

### Requirement: Timeline cursor SHALL use a draggable handle
The bottom feature timeline SHALL expose the document cursor as a draggable vertical-bar handle using the requested two-arrow Unicode glyph instead of back or forward step buttons.

#### Scenario: Render the timeline cursor
- **WHEN** the bottom feature timeline renders the current document cursor
- **THEN** it shows a draggable vertical-bar handle using the two-arrow Unicode glyph and does not render separate step-back or step-forward cursor buttons

#### Scenario: Start dragging the cursor
- **WHEN** the user presses and drags the timeline cursor handle
- **THEN** the timeline enters a drag interaction for repositioning the document cursor

### Requirement: Timeline cursor dragging SHALL snap to valid rollback positions
Dragging the timeline cursor SHALL snap only to valid document cursor positions derived from the current feature sequence.

#### Scenario: Drag toward an earlier feature position
- **WHEN** the user drags the cursor handle toward an earlier valid feature anchor
- **THEN** the handle snaps to that valid rollback position instead of stopping at an arbitrary pixel location

#### Scenario: Drag between valid anchors
- **WHEN** the user drags the cursor handle between two valid feature anchors
- **THEN** the timeline resolves the nearest valid snapped position and does not commit an invalid in-between cursor state
