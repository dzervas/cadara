## MODIFIED Requirements

### Requirement: OCC startup SHALL begin eagerly and expose initial render progress
The application SHALL begin loading the active browser OpenCascade runtime owner during bootstrap module execution before React mount, SHALL prepare the startup runtime state needed for the first OCC-backed snapshot, and SHALL expose a whole-viewport pending state until the first OCC-backed document render is ready or an initialization error is reported.

#### Scenario: Browser bootstrap runs before user modeling input
- **WHEN** the browser executes the application bootstrap modules before the React tree mounts
- **THEN** the active OCC runtime owner starts warming without waiting for a toolbar action, sketch action, feature action, document mutation, or post-render React effect
- **AND** the eager warm path does not create a second OCC runtime owner when worker-backed OCC initialization is available

#### Scenario: Warm startup prepares first-snapshot state
- **WHEN** the eager OCC warm path completes successfully
- **THEN** the active runtime owner has initialized OpenCascade and prepared the startup authoring state required for the first document snapshot
- **AND** the first OCC-backed snapshot does not pay a second cold initialization cost for the same runtime owner

#### Scenario: Initial render is pending
- **WHEN** the active document has not yet produced its first OCC-backed workspace snapshot
- **THEN** the viewport presents a loading indicator that occupies the full modeling viewport
- **AND** the loading state does not hide the application shell controls outside the viewport

#### Scenario: OCC initialization fails
- **WHEN** the eager OpenCascade warm path rejects
- **THEN** the failure is surfaced through the existing application error path
- **AND** the failure is not swallowed or replaced by an indefinite loading state

### Requirement: OCC initialization and render snapshot work SHALL run off the main thread
The OCC-backed browser modeling runtime SHALL perform OpenCascade initialization, committed document rebuilds, mutation execution, snapshot building, and viewport tessellation in a dedicated Web Worker when browser worker support is available.

#### Scenario: Worker-capable browser starts OCC runtime
- **WHEN** the browser supports the module-worker features required by the application build
- **THEN** the browser OCC runtime owner initializes in the OCC worker instead of blocking the main UI thread

#### Scenario: User mutates the document after startup
- **WHEN** the browser OCC runtime owner has already been warmed and the user triggers a modeling mutation
- **THEN** the mutation executes through the same worker-owned OCC runtime that serves snapshots
- **AND** the browser does not initialize a second main-thread OCC runtime to accept the mutation

#### Scenario: Snapshot follows unchanged committed state
- **WHEN** the main thread requests a workspace snapshot for committed authoring state already owned by the OCC worker
- **THEN** the worker reuses its retained authoring state for snapshot generation
- **AND** it does not replay the unchanged document into a fresh OCC runtime state before every snapshot

#### Scenario: Worker initialization fails
- **WHEN** the OCC worker cannot initialize the OpenCascade runtime
- **THEN** the main thread receives a structured failure
- **AND** the error is reported through the same application error path used by non-worker OCC failures
