## ADDED Requirements

### Requirement: Viewport SHALL expose draggable dimension preview geometry
The viewport SHALL render pending dimension preview geometry as draggable authoring controls when the active sketch tool declares a draggable dimension line or angle arc.

#### Scenario: User drags a pending dimension line
- **WHEN** a pending linear or diameter dimension preview declares a draggable dimension line and the user drags that line
- **THEN** the viewport routes the drag update to the active sketch authoring state
- **AND** the preview line, extension lines, label anchor, and floating value input update to the new sketch-plane placement without committing a durable dimension

#### Scenario: User drags a pending angle arc
- **WHEN** a pending angle dimension preview declares a draggable angle arc and the user drags that arc
- **THEN** the viewport routes the drag update to the active sketch authoring state
- **AND** the preview arc, label anchor, and floating value input update to the new sketch-plane arc placement without committing a durable dimension

#### Scenario: Drag is cancelled
- **WHEN** the user cancels an active dimension placement drag before accepting the dimension
- **THEN** the viewport stops the drag interaction
- **AND** the durable sketch definition remains unchanged

### Requirement: Viewport SHALL render committed dimensions from stored annotation placement
The viewport SHALL derive committed distance, diameter, and angle annotation graphics from solved sketch geometry plus the dimension's stored annotation placement metadata.

#### Scenario: Committed linear dimension has placement metadata
- **WHEN** the viewport renders a committed distance or diameter dimension with stored dimension-line placement metadata
- **THEN** it displays the dimension annotation using that stored placement relative to the solved target geometry

#### Scenario: Committed angle dimension has placement metadata
- **WHEN** the viewport renders a committed angle dimension with stored arc placement metadata
- **THEN** it displays the angle annotation using that stored arc placement relative to the solved line references

#### Scenario: Committed dimension has no placement metadata
- **WHEN** the viewport renders an existing committed dimension that lacks stored annotation placement metadata
- **THEN** it displays the dimension using a deterministic default placement derived from solved geometry
- **AND** it does not mutate the sketch definition merely to render the fallback annotation

### Requirement: Viewport dimension placement SHALL preserve existing viewport interactions
Dimension preview dragging SHALL use declared overlay geometry hit targets without breaking normal sketch target picking, selection, pan, rotate, or active drawing-tool behavior.

#### Scenario: Pointer starts on draggable preview geometry
- **WHEN** the pointer drag starts on a declared draggable dimension line or angle arc
- **THEN** the viewport captures that drag for dimension placement until release or cancellation

#### Scenario: Pointer starts outside draggable preview geometry
- **WHEN** the pointer interaction starts outside declared draggable dimension preview geometry
- **THEN** the viewport continues to route the interaction through the existing target picking, drawing, selection, pan, or rotate behavior
