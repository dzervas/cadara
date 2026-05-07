## ADDED Requirements

### Requirement: Startup telemetry SHALL distinguish canvas, kernel, snapshot, and geometry readiness
The application SHALL emit performance telemetry for startup readiness phases without treating first snapshot availability as equivalent to first visible geometry draw.

#### Scenario: Canvas is created before geometry is visible
- **WHEN** the viewport renderer creates the canvas and renderer context
- **THEN** startup telemetry records the canvas-created phase
- **AND** this phase does not imply that OCC geometry has been drawn

#### Scenario: OCC warmup settles
- **WHEN** eager browser OCC warmup fulfills or rejects
- **THEN** startup telemetry records the warmup-settled phase with a success or failure classification
- **AND** an OCC warmup failure is still surfaced through the existing application error path

#### Scenario: First snapshot is ready
- **WHEN** the active document produces its first OCC-backed workspace snapshot
- **THEN** startup telemetry records the first-snapshot-ready phase
- **AND** the phase can include cheap document complexity counts already present on the snapshot

#### Scenario: First geometry frame is drawn
- **WHEN** the viewport renders a frame containing non-empty committed 3D geometry from the active snapshot
- **THEN** startup telemetry records the first-non-empty-geometry-frame phase
- **AND** the signal is emitted once per startup lifecycle
