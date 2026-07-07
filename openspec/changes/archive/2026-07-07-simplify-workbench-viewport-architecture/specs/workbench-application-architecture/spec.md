## ADDED Requirements

### Requirement: Application bootstrap SHALL be separated from workbench feature implementation
The application architecture SHALL keep `src/app` focused on application bootstrap and composition while workbench feature implementation lives behind a dedicated workbench module boundary.

#### Scenario: Application mounts the workbench
- **WHEN** the application creates root services, runtime registries, document session dependencies, and top-level providers
- **THEN** that bootstrap composition may live in `src/app`
- **AND** detailed workbench feature implementation lives in the dedicated workbench module rather than in `src/app`

#### Scenario: Workbench feature code is added
- **WHEN** new workbench behavior is introduced for shell composition, viewport integration, document actions, history, debug, or object actions
- **THEN** it is added under the workbench module's concern-specific subareas
- **AND** `src/app` does not become the default home for feature implementation or app-layer specs

### Requirement: Workbench action orchestration SHALL use named commands or use-cases
Workbench action orchestration SHALL be expressed as named commands or use-cases with explicit inputs and outputs, with React controller adapters limited to binding current state and UI events.

#### Scenario: Document-facing action is implemented
- **WHEN** a workbench action such as rename, delete, suppress, variable update, save, open, export, or tab close/save coordination is implemented
- **THEN** the core orchestration lives in a named command or use-case module
- **AND** React hooks do not hide that behavior inside broad objects of unrelated callbacks

#### Scenario: React controller adapter binds UI state
- **WHEN** the shell needs callbacks for toolbar, viewport, timeline, tabs, modals, or object overlays
- **THEN** a thin React adapter may bind the current editor/workbench state to named commands and callbacks
- **AND** the adapter does not become the authoritative owner of document state or modeling mutation sequencing

### Requirement: Workbench shell SHALL compose visible regions from prepared models and actions
The workbench shell SHALL be organized around visible UI regions and SHALL consume prepared view models and action groups from workbench controller adapters.

#### Scenario: Shell renders primary workbench regions
- **WHEN** the shell renders the viewport, toolbar, object tree, inspector layer, document modals, timeline, and tabs
- **THEN** each region receives explicit props or region models
- **AND** the shell does not inline unrelated document, debug, history, variable, import, or viewport orchestration logic

#### Scenario: A region needs editor state
- **WHEN** a presentational region needs editor-derived data
- **THEN** the workbench controller prepares that data for the region
- **AND** the region does not independently read global editor/workbench context unless it is explicitly designated as a provider boundary

### Requirement: Large or convoluted files SHALL use SLOP ownership comments when retained
Large or convoluted files that remain after an architecture step SHALL have a top-of-file ownership/debt comment when that comment helps readers understand why the file still exists, and every such file-level comment MUST start with `// SLOP:`.

#### Scenario: Migration keeps a large orchestration file
- **WHEN** a migration step intentionally keeps a large or convoluted workbench, viewport, controller, or application file
- **THEN** the file has a top-of-file comment starting with `// SLOP:` that states the file's temporary ownership role or split direction
- **AND** the comment is specific enough to guide the next cleanup step

#### Scenario: File is small and ownership is obvious
- **WHEN** a file has a clear single responsibility and a comment would not add useful ownership context
- **THEN** no `// SLOP:` comment is required
- **AND** ordinary implementation comments remain optional and focused on non-obvious logic

#### Scenario: File-level architecture debt comment is added
- **WHEN** a top-of-file comment is added to explain a large or convoluted file
- **THEN** the comment starts exactly with `// SLOP:`
- **AND** no alternate prefixes such as `TODO`, `NOTE`, or `Deprecated` are used for that file-level ownership/debt marker
