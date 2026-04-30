## ADDED Requirements

### Requirement: Workbench orchestration SHALL be owned by dedicated application-layer controllers
The workbench SHALL organize non-render orchestration into dedicated application-layer controllers or hooks grouped by user-facing concern instead of accumulating unrelated coordination logic inside the top-level shell component.

#### Scenario: History, import, and document actions are composed into the shell
- **WHEN** the workbench renders toolbar, viewport, and inspector surfaces
- **THEN** history coordination, import entry, and document file actions are provided by dedicated application-layer modules
- **AND** the top-level shell composes those modules rather than implementing each concern inline

#### Scenario: New workbench flow is added
- **WHEN** a new application concern such as a file action or workbench notification flow is introduced
- **THEN** the implementation is added to a dedicated application-layer controller for that concern
- **AND** the top-level shell does not become the default home for new orchestration logic

### Requirement: The top-level workbench shell SHALL remain render-focused
The top-level workbench shell SHALL primarily compose view models, callbacks, and presentational components, and SHALL keep only narrow UI-local state such as layout affordances or purely visual toggles.

#### Scenario: Shell renders the workbench
- **WHEN** the workbench shell renders the sidebar, viewport, toolbar, overlays, and inspectors
- **THEN** it consumes prepared callbacks and view models from application-layer controllers
- **AND** it does not directly own browser file-picker flows, multi-step modeling mutations, or shared command-family coordination

#### Scenario: UI-local layout state remains in the shell
- **WHEN** the shell tracks a purely presentational concern such as sidebar width or modal open state
- **THEN** that state may remain shell-local
- **AND** the state does not become the owner of document, import, history, or command sequencing behavior

### Requirement: `app/` SHALL be the top dependency layer for workbench orchestration
Modules outside `src/app/` SHALL NOT import workbench application-composition modules from `src/app/`, and any helper needed by lower layers SHALL live in a neutral lower layer instead.

#### Scenario: Lower layer needs a shared helper
- **WHEN** a component, hook, domain module, or contract type needs a helper or type currently defined in `src/app/`
- **THEN** the shared helper or type is moved to an appropriate lower layer such as `domain`, `contracts`, or `lib`
- **AND** the lower layer does not import the `app` module directly

#### Scenario: Boundary regression check runs
- **WHEN** architecture regression checks run
- **THEN** they fail if a module outside `src/app/` imports a workbench application module from `src/app/`

