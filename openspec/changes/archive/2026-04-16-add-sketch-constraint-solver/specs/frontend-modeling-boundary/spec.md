## MODIFIED Requirements

### Requirement: Frontend durable modeling actions pass through a modeling service boundary
The system SHALL route durable modeling actions from frontend/editor code through a frontend-facing modeling service or adapter boundary instead of allowing UI components to call a kernel implementation directly, and sketch solving within those flows SHALL continue to pass through the dedicated solver boundary rather than bypassing it from frontend or kernel code.

#### Scenario: Frontend commits a durable modeling action
- **WHEN** the editor commits a durable action such as sketch commit, feature create, feature update, feature delete, preview evaluation, or reference resolution
- **THEN** the action is issued through the modeling service boundary rather than directly from a UI component to a kernel implementation

#### Scenario: React workbench component needs model data
- **WHEN** a presentational component needs committed model state, reference resolution, or render export data
- **THEN** it consumes that data through the frontend-facing modeling service boundary instead of importing or invoking a kernel implementation directly

#### Scenario: Modeling flow needs sketch solving
- **WHEN** a modeling adapter needs authored sketch validation, solving, or derived sketch regions
- **THEN** it performs that work through the `SketchSolverAdapter` boundary backed by a sketch-only solver subsystem instead of embedding solve math directly in frontend components or kernel-specific code
