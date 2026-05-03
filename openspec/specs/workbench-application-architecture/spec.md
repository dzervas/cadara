# workbench-application-architecture Specification

## Purpose
TBD - created by archiving change clarify-workbench-architecture-boundaries. Update Purpose after archive.
## Requirements
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

### Requirement: Workbench shells SHALL not own document-facing repair state
The top-level workbench shell and shell-adjacent presentation state SHALL NOT become the owner of document refresh repair, accepted mutation reconciliation, or other document-facing state repair logic.

#### Scenario: Ordinary mutation completes
- **WHEN** a document-facing workbench mutation completes
- **THEN** shell composition code consumes updated callbacks or state from controllers and runtime
- **AND** the shell does not maintain its own repair path for reconciling the accepted document state

#### Scenario: Shell resets UI-local state after document replacement
- **WHEN** an explicit whole-document replacement flow completes
- **THEN** the shell may reset UI-local presentation state such as modal visibility or hidden-item affordances
- **AND** the shell does not become the authoritative owner of the replacement sequencing itself

### Requirement: Application controllers SHALL delegate document ownership rather than mirror it
Application-layer controllers SHALL compose browser-facing coordination and user-facing concern slices without mirroring authoritative document or command-session state in controller-local stores.

#### Scenario: Controller handles document-facing concern
- **WHEN** a controller handles history, import completion, rename, or document action coordination
- **THEN** it delegates authoritative document updates to the runtime-owned path
- **AND** it does not keep a competing controller-local source of truth for the same concern

### Requirement: Workbench document sessions SHALL be composed as application-owned active-session hosts
The application architecture SHALL compose the active workbench document session from application-owned bootstrap or workbench modules instead of embedding singleton document-session mutation logic directly into the top-level shell component.

#### Scenario: Workbench starts an active document session
- **WHEN** the workbench boots or restores an active tab
- **THEN** application-owned composition creates the active document-scoped modeling service and editor/runtime provider graph for that tab's `documentId`
- **AND** the top-level shell consumes that composed session rather than instantiating or retargeting singleton document-session services inline

#### Scenario: Active tab changes
- **WHEN** the user activates a different document tab
- **THEN** the workbench swaps to a newly composed active session for the selected `documentId`
- **AND** the shell remains render-focused while consuming the new active session's callbacks and view models

### Requirement: Extension registry composition SHALL be application-owned bootstrap work
The application architecture SHALL treat provider and mode registry composition as an application or bootstrap concern rather than a responsibility of shell components or unrelated domain service constructors.

#### Scenario: Application starts built-in extension surfaces
- **WHEN** the application prepares workbench services and UI surfaces
- **THEN** it composes the built-in extension registries explicitly during bootstrap
- **AND** no shell component is responsible for registering providers or modes during render

#### Scenario: Domain service consumes extension lookup
- **WHEN** a domain service needs extension lookup capability
- **THEN** the application wiring passes that capability into the service explicitly
- **AND** the service does not take ownership of built-in extension registration

### Requirement: Debug bridge bootstrap SHALL be application-owned composition work
The workbench application architecture SHALL treat dev debug namespace installation, browser-facing debug coordination, and debug-surface composition as dedicated application-layer work rather than as ad hoc shell helpers or lower-layer imports.

#### Scenario: Workbench starts in dev mode
- **WHEN** the application boots in a dev or test build
- **THEN** dedicated application-layer modules install or compose the debug bridge
- **AND** the top-level workbench shell consumes that composed bridge rather than defining the browser debug contract inline

#### Scenario: Lower layer needs debug data
- **WHEN** runtime, domain, or contract code needs to provide debug data to the platform
- **THEN** that data is passed through narrow application-facing interfaces
- **AND** lower layers do not import `src/app/` debug composition modules directly
