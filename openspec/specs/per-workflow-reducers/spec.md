# per-workflow-reducers Specification

## Purpose

Define the reducer architecture that routes editor events through workflow-local reducers with narrowed state and event types before shared root handling.

## Requirements

### Requirement: Root reducer SHALL route events to the active workflow reducer with narrowed types
The root reducer SHALL determine the active workflow from `state.kind`, narrow the state to the workflow-specific type, check if the event belongs to the workflow's event subset, and delegate to the corresponding workflow reducer before falling back to shared event handling.

#### Scenario: Event handled by workflow reducer
- **WHEN** an event is dispatched and it matches the active workflow's event subset
- **THEN** the root reducer narrows the state type and passes the narrowed state and event to the workflow reducer
- **AND** the workflow reducer's result is returned without consulting shared handlers

#### Scenario: Event not handled by workflow reducer
- **WHEN** an event is dispatched and it does not match the active workflow's event subset
- **THEN** the root reducer applies shared event handling (viewport, document, tool activation, effect completions)

#### Scenario: No active workflow (idle state)
- **WHEN** the editor is in `idle` state and an event is dispatched
- **THEN** the root reducer applies shared event handling directly without routing to a workflow reducer

### Requirement: Workflow reducers SHALL receive narrowed state and event types
Each workflow reducer SHALL accept its workflow-specific state type (e.g., `SketchEditorState`) and a workflow-scoped event subset type, eliminating the need for `state.kind` checks inside workflow handlers.

#### Scenario: Sketch reducer receives SketchEditorState
- **WHEN** the root reducer routes to the sketch workflow
- **THEN** the sketch reducer receives `SketchEditorState` as its state parameter
- **AND** it receives only events from the sketch event subset
- **AND** it does not check `state.kind`

#### Scenario: Feature reducer receives FeatureEditorState
- **WHEN** the root reducer routes to the feature workflow
- **THEN** the feature reducer receives `FeatureEditorState` as its state parameter
- **AND** it receives only events from the feature event subset

#### Scenario: Import reducer receives ImportEditorState
- **WHEN** the root reducer routes to the import workflow
- **THEN** the import reducer receives `ImportEditorState` as its state parameter

#### Scenario: Section reducer receives SectionViewEditorState
- **WHEN** the root reducer routes to the section workflow
- **THEN** the section reducer receives `SectionViewEditorState` as its state parameter

### Requirement: Workflow event subset types SHALL be explicit Extract unions
Each workflow's accepted event subset SHALL be defined as an explicit `Extract` union from `EditorEvent`, making the routing decision statically verifiable.

#### Scenario: New event added without workflow assignment
- **WHEN** a new event type is added to `EditorEvent` but not to any workflow's event subset
- **THEN** the event falls through to shared handling
- **AND** the shared handler's exhaustive switch catches unhandled events at compile time

### Requirement: Shared event handling SHALL cover cross-cutting concerns
The root reducer SHALL handle events that apply regardless of workflow state, including viewport interaction, document lifecycle, tool activation, and effect completions.

#### Scenario: Viewport events handled in any state
- **WHEN** a `viewport.*` event is dispatched in any workflow state
- **THEN** the root reducer handles it through shared viewport logic

#### Scenario: Document events handled in any state
- **WHEN** a `document.*` event is dispatched in any workflow state
- **THEN** the root reducer handles it through shared document logic

#### Scenario: Effect completion events handled at root
- **WHEN** an `effect.*` event is dispatched
- **THEN** the root reducer handles it through shared effect completion logic

### Requirement: The root reducer SHALL preserve the existing function signature
The root reducer SHALL export `transitionEditorState` with the identical signature and return type as the current implementation.

#### Scenario: Signature compatibility
- **WHEN** a consumer calls `transitionEditorState(state, event, deps)`
- **THEN** it returns `EditorTransitionResult` with `{ state: EditorState, effects: EditorEffect[] }`
