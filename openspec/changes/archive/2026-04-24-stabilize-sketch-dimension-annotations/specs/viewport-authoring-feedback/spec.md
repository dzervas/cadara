## ADDED Requirements

### Requirement: Viewport SHALL initiate committed dimension placement drags from the dimension annotation chip
The viewport SHALL use the visible committed dimension annotation chip as the drag handle for committed dimension placement updates.

#### Scenario: User drags a committed dimension annotation chip
- **WHEN** the user starts a drag on the visible chip for a committed distance, radius, diameter, or angle dimension annotation
- **THEN** the viewport routes the drag through the committed dimension placement update path
- **AND** the committed dimension overlay geometry updates to the dragged placement
- **AND** the durable dimension target remains selected while the drag is in progress

#### Scenario: User drags committed dimension overlay geometry without starting on the annotation chip
- **WHEN** the pointer starts on committed dimension line or angle-arc overlay geometry outside the annotation chip
- **THEN** the viewport does not treat that gesture as the committed dimension placement drag handle
- **AND** existing non-dimension viewport interactions remain available

### Requirement: Viewport SHALL render angular witness lines for off-segment intersections
The viewport SHALL render dashed witness geometry for angular dimensions when the measured angle references the infinite extension of one or both finite line segments.

#### Scenario: Angular dimension references an intersection beyond the selected line segments
- **WHEN** a committed or preview angular dimension is derived from two non-parallel lines whose true intersection lies outside one or both finite segments
- **THEN** the viewport renders dashed witness lines extending beyond the finite segments toward the measured angle arc endpoints
- **AND** the witness lines make the referenced angle legible without changing the underlying authored line geometry

#### Scenario: Angular dimension does not require off-segment witness geometry
- **WHEN** a committed or preview angular dimension's measured intersection lies on the visible finite line segments
- **THEN** the viewport renders the angular annotation without adding misleading extra extension beyond what the measured geometry requires
