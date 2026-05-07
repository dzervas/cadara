# occ-initial-render-latency Specification

## Purpose
TBD - created by archiving change optimize-occ-initial-render-latency. Update Purpose after archive.
## Requirements
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
- **WHEN** the eager OpenCascade load rejects
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

### Requirement: Worker mesh transfer SHALL avoid cloning large buffers
The worker-to-main-thread render snapshot protocol SHALL transfer mesh typed-array buffers as transferables when crossing the worker boundary.

#### Scenario: Worker returns mesh render data
- **WHEN** the OCC worker posts render records containing vertex positions, vertex normals, or triangle indices
- **THEN** the posted typed arrays either own tightly packed `ArrayBuffer` objects or include explicit `byteOffset`, `byteLength`, and element-count metadata for each view
- **AND** the transferable backing `ArrayBuffer` objects for those typed arrays are included in the transfer list

#### Scenario: Main thread receives transferred mesh data
- **WHEN** the main thread receives transferred mesh buffers
- **THEN** it reconstructs render records without structured-cloning the mesh payloads
- **AND** the render contract still exposes the same mesh geometry fields to the viewport
- **AND** reconstruction uses each typed array's owned buffer or explicit view metadata without reading unrelated bytes from a larger shared buffer

### Requirement: OCC WASM and worker assets SHALL be cacheable and streaming-compatible
The application SHALL serve or cache OpenCascade WASM and worker assets so repeat loads can reuse browser cache storage and WASM streaming compilation remains available when the runtime supports it.

#### Scenario: Browser requests OCC WASM
- **WHEN** the browser requests the OpenCascade WASM asset
- **THEN** the response is eligible for repeat-load caching through HTTP cache headers or an explicit service worker cache
- **AND** the response uses the `application/wasm` MIME type when served by the application

#### Scenario: Browser requests OCC worker asset
- **WHEN** the browser requests the OCC worker asset
- **THEN** the response is eligible for repeat-load caching through HTTP cache headers or an explicit service worker cache

#### Scenario: Streaming compilation is unavailable
- **WHEN** the OpenCascade package or current runtime cannot use `WebAssembly.instantiateStreaming`
- **THEN** OCC initialization falls back to supported ArrayBuffer instantiation without changing the user-visible loading and error states

### Requirement: Viewport tessellation SHALL support coarse initial meshes and adaptive refinement
The OCC render pipeline SHALL use coarser tessellation for initial and distant viewport renders and SHALL allow finer tessellation when the camera zooms close enough to require additional detail.

#### Scenario: First document render uses startup tessellation
- **WHEN** the first OCC-backed document render is produced
- **THEN** body and sketch-region tessellation use coarse startup defaults in the range of 0.5 to 1.0 model units linear deflection and 1.0 to 2.0 degree-equivalent angular deflection converted to the OCC API's expected unit unless a stricter viewport LOD tier is explicitly requested

#### Scenario: Camera is far from a body
- **WHEN** a body projects below the fine-detail screen-size threshold for the current camera
- **THEN** the viewport uses or requests a coarse mesh for that body

#### Scenario: Camera zooms into a body
- **WHEN** a body projects above the fine-detail screen-size threshold for the current camera
- **THEN** the viewport requests or uses a finer mesh for that body without rebuilding unchanged document topology

### Requirement: Startup telemetry SHALL distinguish canvas, kernel, snapshot, and geometry readiness
The application SHALL emit performance telemetry for startup readiness phases without treating first snapshot availability as equivalent to first visible geometry draw.

#### Scenario: Canvas is created before geometry is visible
- **WHEN** the viewport renderer creates the canvas and renderer context
- **THEN** startup telemetry records the canvas-created phase
- **AND** this phase does not imply that OCC geometry has been drawn

#### Scenario: OCC warmup settles
- **WHEN** eager browser OCC warmup fulfills or rejects
- **THEN** startup telemetry records the warmup-settled phase with a success or failure classification
- **AND** an OCC warmup failure is still surfaced through the existing application error path

#### Scenario: First snapshot is ready
- **WHEN** the active document produces its first OCC-backed workspace snapshot
- **THEN** startup telemetry records the first-snapshot-ready phase
- **AND** the phase can include cheap document complexity counts already present on the snapshot

#### Scenario: First geometry frame is drawn
- **WHEN** the viewport renders a frame containing non-empty committed 3D geometry from the active snapshot
- **THEN** startup telemetry records the first-non-empty-geometry-frame phase
- **AND** the signal is emitted once per startup lifecycle

