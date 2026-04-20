## ADDED Requirements

### Requirement: Sketch BVH invalidation SHALL distinguish structural changes from positional updates
The workbench viewport SHALL keep BVH-backed picking state structurally stable when active sketch renderable point positions change without changing renderable identity, geometry kind, line pattern, or target binding.

#### Scenario: Sketch point positions change during drag
- **WHEN** a direct sketch geometry drag updates only the coordinates of existing active sketch renderables
- **THEN** the viewport does not remount the BVH tree solely because those coordinates changed
- **AND** existing target bindings remain valid for subsequent hover and selection resolution

#### Scenario: Sketch renderable structure changes
- **WHEN** active sketch renderables change identity, geometry kind, line pattern, or durable target binding
- **THEN** the viewport invalidates or rebuilds BVH-backed picking state before the next accelerated pick evaluation

### Requirement: Sketch display nodes SHALL update positional geometry without recreating structural objects
The workbench viewport SHALL update active sketch line buffers and marker positions in place for positional-only changes while keeping structural Three.js objects stable.

#### Scenario: Polyline coordinates update
- **WHEN** an active sketch polyline renderable receives new coordinates with the same structural identity and line pattern
- **THEN** the viewport updates the existing geometry buffer positions
- **AND** it does not recreate the line object solely for the coordinate update

#### Scenario: Marker coordinate updates
- **WHEN** an active sketch marker renderable receives a new position with the same structural identity and style
- **THEN** the viewport updates the marker position
- **AND** it does not recreate marker materials solely for the coordinate update
