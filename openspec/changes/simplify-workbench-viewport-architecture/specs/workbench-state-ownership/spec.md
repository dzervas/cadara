## ADDED Requirements

### Requirement: Viewport communication ports SHALL not become state owners
Viewport communication ports, channels, atoms, callbacks, or external stores SHALL NOT become authoritative owners of document, sketch, selection, command, history, or modeling mutation state.

#### Scenario: Viewport intent updates selection
- **WHEN** the viewport emits a target selection intent
- **THEN** the workbench controller routes the intent to the authoritative editor runtime owner
- **AND** the viewport communication mechanism does not store selection as an independent source of truth

#### Scenario: Viewport command requests camera behavior
- **WHEN** the workbench sends a viewport command for camera fitting, camera orientation, projection, or debug projection
- **THEN** the viewport may update viewport-local camera or projection state
- **AND** the command channel does not mutate document or editor runtime state directly

#### Scenario: Future atoms or channels are introduced
- **WHEN** a future implementation introduces Jotai atoms, channels, `useSyncExternalStore`, or another shared communication mechanism for viewport integration
- **THEN** that mechanism is limited to port transport or viewport-local state
- **AND** it does not duplicate authoritative editor runtime state or durable modeling state

### Requirement: Viewport-local state SHALL be explicitly scoped
State owned inside the viewport module SHALL be limited to viewport rendering mechanics and SHALL be named or typed so that it cannot be confused with workbench authoritative state.

#### Scenario: Viewport stores camera state
- **WHEN** the viewport stores camera pose, controls readiness, projection mode, pick bindings, hover projection data, or render invalidation state
- **THEN** that state is treated as viewport-local
- **AND** it is not consumed by non-viewport modules as authoritative workbench state

#### Scenario: Workbench needs derived viewport information
- **WHEN** the workbench needs derived viewport information such as projected screen coordinates for debugging or tests
- **THEN** it requests that information through the viewport command or query port
- **AND** it does not reach into private viewport-local state directly
