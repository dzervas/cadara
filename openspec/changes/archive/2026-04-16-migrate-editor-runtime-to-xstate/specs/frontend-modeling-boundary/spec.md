## MODIFIED Requirements

### Requirement: Frontend durable modeling actions pass through a modeling service boundary
The system SHALL route durable modeling actions from frontend/editor code through a frontend-facing modeling service or adapter boundary instead of allowing UI components to call a kernel implementation directly, and runtime orchestration MAY use a statechart/actor model to invoke that boundary without changing the boundary itself.

#### Scenario: Frontend commits a durable modeling action
- **WHEN** the editor commits a durable action such as sketch commit, feature create, feature update, feature delete, preview evaluation, or reference resolution
- **THEN** the action is issued through the modeling service boundary rather than directly from a UI component to a kernel implementation

#### Scenario: Runtime orchestration implementation changes
- **WHEN** the frontend changes its internal runtime orchestration model, such as moving from a custom reducer/effect runner to a statechart-owned invocation model
- **THEN** durable modeling actions still pass through the same frontend-facing modeling service boundary rather than bypassing it
