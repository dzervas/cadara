## ADDED Requirements

### Requirement: Root reducer SHALL route events to the active workflow reducer
The root reducer SHALL determine the active workflow from `state.kind` and delegate event handling to the corresponding workflow reducer before falling back to shared event handling.

#### Scenario: Event handled by workflow reducer
- **WHEN** an event is dispatched and the active workflow reducer returns a non-null result
- **THEN** the root reducer returns that result without consulting shared handlers

#### Scenario: Event not handled by workflow reducer
- **WHEN** an event is dispatched and the active workflow reducer returns null
- **THEN** the root reducer applies shared event handling (viewport, document, tool activation, effect completions)

#### Scenario: No active workflow (idle state)
- **WHEN** the editor is in `idle` state and an event is dispatched
- **THEN** the root reducer applies shared event handling directly without routing to a workflow reducer

### Requirement: Workflow reducers SHALL only handle events valid for their state kind
Each workflow reducer SHALL accept only events relevant to its workflow and return null for all other events.

#### Scenario: Sketch reducer handles sketch events
- **WHEN** the editor is in `editingSketch` state and a `sketch.*` event is dispatched
- **THEN** the sketch workflow reducer handles the event and returns an `EditorTransitionResult`

#### Scenario: Sketch reducer ignores import events
- **WHEN** the editor is in `editingSketch` state and an `import.*` event is dispatched
- **THEN** the sketch workflow reducer returns null
- **AND** the root reducer handles the event through shared logic

#### Scenario: Feature reducer handles feature form events
- **WHEN** the editor is in `editingFeature` state and a `form.*` event is dispatched
- **THEN** the feature workflow reducer handles the event

#### Scenario: Import reducer handles import events
- **WHEN** the editor is in `importing` state and an `import.*` event is dispatched
- **THEN** the import workflow reducer handles the event

#### Scenario: Section reducer handles section events
- **WHEN** the editor is in `inspectingSection` state and a `section.*` event is dispatched
- **THEN** the section workflow reducer handles the event

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
- **AND** all existing callers work without modification
