## MODIFIED Requirements

### Requirement: OCC initialization and render snapshot work SHALL run off the main thread
The OCC-backed browser modeling runtime SHALL perform OpenCascade initialization, committed document rebuilds, mutation execution, snapshot building, and viewport tessellation in a dedicated Web Worker when browser worker support is available, and that worker-owned runtime SHALL use the pthread-enabled OCC build rather than a separate non-threaded browser runtime.

#### Scenario: Worker-capable browser starts OCC runtime
- **WHEN** the browser supports the module-worker and shared-memory features required by the application build
- **THEN** the browser OCC runtime owner initializes the pthread-enabled OCC runtime in the OCC worker instead of blocking the main UI thread

#### Scenario: User mutates the document after startup
- **WHEN** the browser OCC runtime owner has already been warmed and the user triggers a modeling mutation
- **THEN** the mutation executes through the same worker-owned pthread-enabled OCC runtime that serves snapshots
- **AND** the browser does not initialize a second main-thread or non-threaded OCC runtime to accept the mutation

#### Scenario: Snapshot follows unchanged committed state
- **WHEN** the main thread requests a workspace snapshot for committed authoring state already owned by the OCC worker
- **THEN** the worker reuses its retained authoring state for snapshot generation
- **AND** it does not replay the unchanged document into a fresh OCC runtime state before every snapshot

#### Scenario: Worker initialization fails
- **WHEN** the OCC worker cannot initialize the pthread-enabled OpenCascade runtime
- **THEN** the main thread receives a structured failure
- **AND** the error is reported through the same application error path used by other OCC startup failures

### Requirement: OCC WASM and worker assets SHALL be cacheable and streaming-compatible
The application SHALL serve or cache OpenCascade WASM, OCC worker, and pthread helper-worker assets so repeat loads can reuse browser cache storage and the runtime can resolve every required asset without changing the user-visible loading and error states.

#### Scenario: Browser requests OCC WASM
- **WHEN** the browser requests the OpenCascade WASM asset
- **THEN** the response is eligible for repeat-load caching through HTTP cache headers or an explicit service worker cache
- **AND** the response uses the `application/wasm` MIME type when served by the application

#### Scenario: Browser requests OCC worker asset
- **WHEN** the browser requests the OCC worker asset
- **THEN** the response is eligible for repeat-load caching through HTTP cache headers or an explicit service worker cache

#### Scenario: Browser requests pthread helper worker asset
- **WHEN** the browser requests a helper worker asset required by the pthread-enabled OCC runtime
- **THEN** the response is eligible for repeat-load caching through HTTP cache headers or an explicit service worker cache
- **AND** the helper worker asset resolves from an app-owned runtime URL that matches the active build

#### Scenario: Streaming compilation is unavailable
- **WHEN** the OpenCascade package or current runtime cannot use `WebAssembly.instantiateStreaming`
- **THEN** OCC initialization falls back to supported ArrayBuffer instantiation without changing the user-visible loading and error states
