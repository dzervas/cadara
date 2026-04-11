## ADDED Requirements

### Requirement: Viewport picking SHALL support drei `<Bvh>`-backed geometric acceleration
The workbench viewport SHALL support drei `<Bvh>`-backed geometric acceleration for supported renderable geometry so hover and selection remain responsive as scene complexity grows.

#### Scenario: Hover a target in a dense scene
- **WHEN** the viewport evaluates hover against supported geometry in a dense scene
- **THEN** it uses the drei `<Bvh>`-accelerated intersection path for that geometry instead of only relying on unaccelerated full-scene ray intersection

#### Scenario: Select a target in a dense scene
- **WHEN** the user clicks supported geometry in a dense scene
- **THEN** the viewport uses the drei `<Bvh>`-accelerated intersection path before resolving the corresponding target binding

### Requirement: BVH acceleration SHALL preserve existing picking semantics
The workbench viewport SHALL preserve its current durable target binding, selection filtering, and hover-resolution semantics when BVH acceleration is enabled.

#### Scenario: Hover a valid durable target
- **WHEN** the pointer hovers a renderable whose durable target is valid for the current interaction context
- **THEN** the viewport resolves the same bound target and hover behavior as the non-accelerated path

#### Scenario: Click a valid durable target
- **WHEN** the user clicks a renderable whose durable target is valid for the current interaction context
- **THEN** the viewport resolves and dispatches the same bound target as the non-accelerated path

### Requirement: BVH state SHALL stay aligned with viewport geometry rebuilds
The workbench viewport SHALL rebuild or invalidate BVH state whenever supported viewport geometry is rebuilt so accelerated intersections do not target stale geometry.

#### Scenario: Document renderables change
- **WHEN** the viewport rebuilds its supported renderable geometry from updated renderable records
- **THEN** the associated BVH state is rebuilt or replaced before the next accelerated pick evaluation
