## ADDED Requirements

### Requirement: Viewport SHALL communicate through explicit workbench ports
The 3D viewport SHALL communicate with the workbench through explicit typed ports consisting of a viewport model input, viewport intent output, and viewport command input.

#### Scenario: Workbench renders the viewport
- **WHEN** the workbench shell renders the 3D viewport
- **THEN** it provides a prepared viewport model containing scene, interaction, and overlay state required by the viewport
- **AND** the viewport does not derive hidden editor or workbench state from global React contexts

#### Scenario: Viewport reports user interaction
- **WHEN** the user hovers, selects, drags, releases, or edits a target inside the viewport
- **THEN** the viewport emits a typed viewport intent
- **AND** the workbench controller interprets that intent into editor runtime events or application commands

#### Scenario: Workbench requests viewport behavior
- **WHEN** the workbench needs the viewport to perform an imperative behavior such as fit view, camera orientation, projection change, or debug projection
- **THEN** it sends a typed viewport command
- **AND** the viewport handles that command without exposing Three.js internals to the shell

### Requirement: Viewport SHALL not own authoritative workbench state
The viewport SHALL own only viewport-local rendering and interaction mechanics and SHALL NOT own authoritative document, sketch, selection, command, history, or modeling mutation state.

#### Scenario: Viewport resolves a pick target
- **WHEN** the viewport raycaster or projection logic resolves a pick target
- **THEN** the viewport may emit that target as a hover or selection intent
- **AND** it does not directly mutate editor selection state

#### Scenario: Viewport projects sketch pointer input
- **WHEN** the user moves or releases the pointer during sketch editing
- **THEN** the viewport may project the pointer onto the active sketch plane from the provided model
- **AND** it emits the projected point as an intent rather than mutating the sketch session directly

#### Scenario: Viewport changes camera or projection state
- **WHEN** the user or workbench changes camera pose, projection mode, view-cube orientation, or local render invalidation state
- **THEN** the viewport may own that viewport-local state
- **AND** that state does not become the source of truth for document or editor runtime state

### Requirement: Viewport internals SHALL be isolated from shell and application concerns
Viewport internals SHALL be limited to rendering, camera controls, raycasting, picking, sketch-plane projection, viewport overlays, and viewport-local transient state.

#### Scenario: Viewport module needs application data
- **WHEN** viewport rendering or picking needs current selection rules, sketch presentation, special-mode presentation, or visible renderables
- **THEN** the workbench adapter includes the required data in the viewport model
- **AND** the viewport module does not import workbench application controllers, document actions, durable history, modeling service providers, or editor provider hooks

#### Scenario: Viewport module needs registry-derived behavior
- **WHEN** viewport interaction depends on extension or special-mode behavior
- **THEN** the workbench adapter passes a narrow interaction capability or resolved presentation data through the viewport model
- **AND** the viewport does not read the runtime extension registry from a global context

### Requirement: Viewport communication mechanism SHALL remain replaceable
The viewport boundary SHALL be defined by typed ports rather than by a specific transport library.

#### Scenario: Implementation uses callbacks
- **WHEN** viewport intents or commands are implemented with React callbacks or refs
- **THEN** those callbacks satisfy the same typed port contract
- **AND** callers do not rely on private viewport component state

#### Scenario: Implementation later uses channels or atoms
- **WHEN** viewport communication is implemented with channels, Jotai atoms, `useSyncExternalStore`, or another external store mechanism
- **THEN** that mechanism satisfies the same typed port contract
- **AND** it does not introduce a second owner for editor or document state
