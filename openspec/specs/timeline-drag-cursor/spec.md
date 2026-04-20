# timeline-drag-cursor Specification

## Purpose
TBD - created by archiving change improve-workbench-shell-layout. Update Purpose after archive.
## Requirements
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

### Requirement: Timeline cursor drag SHALL commit through editor runtime
The timeline cursor drag interaction SHALL commit document cursor changes by dispatching an editor document cursor request for the snapped target position.

#### Scenario: Drag completes at a new cursor position
- **WHEN** the user releases the timeline cursor handle at a snapped valid cursor position different from the current cursor
- **THEN** the timeline dispatches an editor document cursor request for that cursor
- **AND** it does not directly call the modeling service cursor mutation

#### Scenario: Drag completes at the existing cursor position
- **WHEN** the user releases the timeline cursor handle at the current cursor position
- **THEN** no document cursor mutation is requested

### Requirement: Timeline cursor SHALL not issue overlapping cursor mutations
The timeline SHALL avoid issuing another document cursor request while a previous document cursor mutation or its required follow-up snapshot refresh is pending.

#### Scenario: Drag starts while cursor move is pending
- **WHEN** a document cursor mutation is pending
- **THEN** the timeline cursor handle is not available for a second committed cursor mutation

#### Scenario: Refresh completes after cursor move
- **WHEN** the follow-up snapshot for an accepted cursor move has loaded
- **THEN** the timeline cursor handle can again request a document cursor move based on the refreshed history state

