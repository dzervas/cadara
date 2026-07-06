## MODIFIED Requirements

### Requirement: The orchestrator SHALL apply prepared actions through existing adapter methods
The system SHALL apply all prepared actions returned by a provider through the existing `ModelingKernelAdapter` mutation methods, not through a parallel mutation path. When a provider returns an explicit ordered action sequence, the orchestrator SHALL apply actions in that sequence across action kinds; otherwise it SHALL apply actions grouped by kind as before.

#### Scenario: Feature actions are applied through adapter
- **WHEN** the orchestrator receives `ImportPreparedActions` containing feature creation requests
- **THEN** each request is applied through `ModelingKernelAdapter.createFeature()`
- **AND** the adapter validates the request, assigns revision IDs, and records the operation in history
- **AND** undo/redo covers the imported features

#### Scenario: Sketch actions are applied through adapter
- **WHEN** the orchestrator receives `ImportPreparedActions` containing sketch commit requests
- **THEN** each request is applied through `ModelingKernelAdapter.commitSketch()`
- **AND** the adapter validates the request and records the operation in history

#### Scenario: Variable actions are applied through adapter
- **WHEN** the orchestrator receives `ImportPreparedActions` containing variable addition requests
- **THEN** each request is applied through `ModelingKernelAdapter.addDocumentVariable()`

#### Scenario: Provider specifies an interleaved action order
- **WHEN** `ImportPreparedActions` includes an explicit ordered sequence referencing entries across the kind arrays (e.g. variable, sketch, feature, sketch, feature)
- **THEN** the orchestrator applies the actions in exactly that sequence through the corresponding adapter methods
- **AND** each application continues the single revision chain of the import
- **AND** an ordered sequence that omits or duplicates a prepared action is rejected as invalid before any action is applied

#### Scenario: Provider omits an explicit order
- **WHEN** `ImportPreparedActions` contains no ordered sequence
- **THEN** the orchestrator applies actions grouped by kind in the existing order
- **AND** existing providers observe no behavior change

#### Scenario: Adapter rejection propagates as import failure
- **WHEN** the adapter rejects a prepared action (e.g. invalid feature definition, revision conflict)
- **THEN** the orchestrator reports the adapter diagnostics to the user
- **AND** no partial import is committed — either all actions succeed or the import fails atomically

## ADDED Requirements

### Requirement: Import capabilities SHALL offer a sandboxed history evaluation probe
`ImportCapabilities` SHALL provide a history evaluation probe that executes a candidate ordered action sequence in a sandboxed kernel session and returns per-step topology signatures and diagnostics, without mutating any document, history, or persistent state.

#### Scenario: Provider probes a candidate history during review
- **WHEN** a provider invokes the history probe with a candidate ordered action sequence during `review()` or `prepare()`
- **THEN** the probe rebuilds the sequence in an isolated kernel session on the existing kernel worker path
- **AND** returns, per step, the resulting topology signatures (entity class, geometry type, defining data, centroid, bounding box)
- **AND** no authored document, operation history, or undo state is affected

#### Scenario: Probe step fails to rebuild
- **WHEN** a step in the probed sequence fails in the kernel
- **THEN** the probe returns structured diagnostics for that step and the completed prefix results
- **AND** the failure is not thrown away or silently swallowed

#### Scenario: Probe is unavailable on the platform
- **WHEN** the injected capabilities do not support history probing
- **THEN** the capability is explicitly absent rather than a stub that fabricates signatures
- **AND** providers can detect the absence and degrade their planning accordingly
