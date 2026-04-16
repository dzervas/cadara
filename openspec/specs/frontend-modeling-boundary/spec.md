# frontend-modeling-boundary Specification

## Purpose
TBD - created by archiving change formalize-kernel-adapter-boundary. Update Purpose after archive.
## Requirements
### Requirement: Frontend durable modeling actions pass through a modeling service boundary
The system SHALL route durable modeling actions from frontend/editor code through a frontend-facing modeling service or adapter boundary instead of allowing UI components to call a kernel implementation directly.

#### Scenario: Frontend commits a durable modeling action
- **WHEN** the editor commits a durable action such as sketch commit, feature create, feature update, feature delete, preview evaluation, or reference resolution
- **THEN** the action is issued through the modeling service boundary rather than directly from a UI component to a kernel implementation

#### Scenario: React workbench component needs model data
- **WHEN** a presentational component needs committed model state, reference resolution, or render export data
- **THEN** it consumes that data through the frontend-facing modeling service boundary instead of importing or invoking a kernel implementation directly

### Requirement: Editor interaction concerns remain outside the kernel contract
The system SHALL keep pointer interaction, tool activation, hover state, local drafting previews, and form state in the frontend editor layer rather than in the CAD kernel contract.

#### Scenario: User performs live sketch drafting
- **WHEN** the user drags or previews sketch geometry during an active editing session
- **THEN** the frontend editor layer owns that transient interaction state and the kernel contract is not used as the per-frame drafting mechanism

#### Scenario: User changes toolbar or selection state
- **WHEN** the user activates a tool, changes command phase, or updates hover and selection state
- **THEN** those state transitions are handled in frontend/editor logic without introducing toolbar or pointer semantics into the kernel contract

### Requirement: Kernel implementations remain replaceable behind the same frontend-facing boundary
The system SHALL treat the modeling service contract as the only frontend-facing durable boundary so different kernel implementations can be used without reshaping UI components.

#### Scenario: Kernel implementation is swapped
- **WHEN** the application changes from one modeling kernel implementation to another that satisfies the same public modeling contract
- **THEN** frontend components continue to use the same modeling service boundary instead of depending on implementation-specific kernel details

