## ADDED Requirements

### Requirement: Sketch tool previews SHALL consume snap-adjusted pointer input
The sketch tool editor schema SHALL allow active tool previews to receive snap-adjusted pointer coordinates and snap metadata from the editor layer.

#### Scenario: Drawing preview uses snapped point
- **WHEN** an active sketch drawing tool receives a snapped pointer coordinate
- **THEN** the preview geometry is rendered from the snapped coordinate
- **AND** the tool can still access raw pointer metadata for labels or disambiguation
