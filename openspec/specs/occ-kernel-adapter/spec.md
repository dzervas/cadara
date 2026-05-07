# occ-kernel-adapter Specification

## Purpose
TBD - created by archiving change formalize-kernel-adapter-boundary. Update Purpose after archive.
## Requirements
### Requirement: OCC adapter implements the public modeling contract without frontend leakage
An OpenCascade-backed kernel adapter SHALL satisfy the public modeling contract through the documented adapter surface and SHALL not take ownership of frontend interaction concerns.

#### Scenario: OCC adapter serves modeling operations
- **WHEN** the application uses an OCC-backed kernel adapter for snapshot, sketch commit, feature operations, preview evaluation, or reference resolution
- **THEN** the adapter responds in the public modeling contract shape rather than exposing OCC-specific UI workflows or kernel internals to frontend components

#### Scenario: Frontend performs interactive editing
- **WHEN** the user performs pointer-driven drafting, hover interaction, toolbar changes, or local previews
- **THEN** those concerns remain outside the OCC adapter and are not modeled as kernel-owned interaction APIs

### Requirement: OCC adapter preserves clear separation between public contract data and internal kernel state
An OpenCascade-backed kernel adapter SHALL keep internal OCC-only geometry, bookkeeping, and browser runtime ownership private when the public contract does not expose that data, while still returning contract-valid snapshots, diagnostics, and render exports through one authoritative browser OCC runtime owner.

#### Scenario: Construction plane requires internal plane geometry
- **WHEN** the adapter needs explicit geometric plane data to rebuild or resolve an internal OCC construction plane but the public snapshot does not expose that geometry
- **THEN** the adapter keeps that internal representation private and still returns the public construction snapshot shape defined by the modeling contract

#### Scenario: Adapter evaluates committed authoring state in the browser
- **WHEN** the adapter serves browser snapshot generation or accepted document mutations
- **THEN** one authoritative browser OCC runtime owner evaluates the committed durable authoring state
- **AND** the adapter does not split authoritative browser OCC state across competing main-thread and worker-owned runtimes

#### Scenario: Browser runtime ownership remains internal
- **WHEN** the adapter routes snapshot or mutation work through its chosen browser OCC runtime owner
- **THEN** the frontend continues to receive only the public modeling contract data and documented diagnostics
- **AND** the contract does not require frontend components to reason about OCC runtime placement, duplication, or synchronization

### Requirement: OCC adapter rejects unsupported contract gaps explicitly
An OpenCascade-backed kernel adapter SHALL reject public-contract cases that are not faithfully implementable from the documented contract instead of inventing hidden OCC-specific semantics.

#### Scenario: Revolve uses a construction-backed axis that is not publicly representable
- **WHEN** a revolve request uses a construction-backed axis that the public contract does not define precisely enough to reconstruct
- **THEN** the adapter returns structured diagnostics or rejection rather than inferring an axis from hidden implementation rules

#### Scenario: Committed region reconstruction depends on unavailable projected geometry
- **WHEN** feature execution requires projected sketch geometry that is not reconstructible from the committed public contract
- **THEN** the adapter rejects the operation explicitly and reports the contract limitation to the caller

### Requirement: OCC profile building SHALL consume live-derived projected boundaries
The OCC adapter SHALL build profile wires containing projected geometry boundary segments from live projection data for the active revision.

#### Scenario: Projected segment is resolvable
- **WHEN** the OCC adapter receives a region loop containing a projected geometry segment with live projected geometry available
- **THEN** it reconstructs the corresponding wire segment from the projected geometry
- **AND** it does not reject the loop because of projected geometry

#### Scenario: Projected segment is not resolvable
- **WHEN** the OCC adapter cannot resolve live projected geometry for a projected region segment
- **THEN** it rejects the rebuild with an explicit machine-readable diagnostic
- **AND** it does not copy, cache-as-authoritative, or silently remap the referenced geometry

### Requirement: OCC adapter SHALL keep durable topology naming internally consistent
An OpenCascade-backed kernel adapter SHALL use internal OCC naming data to reconcile topology references across rebuilds while preserving the public modeling contract boundary.

#### Scenario: OCC naming is used during committed rebuild
- **WHEN** the adapter rebuilds committed authoring state containing body replacement operations
- **THEN** it records and resolves body topology through internal OCC naming state
- **AND** it returns contract-valid snapshots, render bindings, and diagnostics without exposing OCC naming internals

#### Scenario: Public topology ids are preserved for unique successors
- **WHEN** an old face, edge, or vertex has exactly one current successor in the final rebuilt body
- **THEN** the adapter keeps the existing public durable topology id bound to that current subshape

#### Scenario: Fresh topology receives fresh public ids
- **WHEN** a feature creates topology that is not the unique successor of any previous public topology reference
- **THEN** the adapter assigns fresh public durable topology ids that do not collide with preserved ids

#### Scenario: Reference resolution uses final refined shape
- **WHEN** a boolean result is simplified or same-domain unified before becoming the committed body shape
- **THEN** topology naming resolves references against the final stored body shape
- **AND** it does not leave durable references bound only to pre-refinement builder output

### Requirement: OCC adapter SHALL restore STEP import features from assets
The OCC kernel adapter SHALL rebuild STEP import features from referenced geometry assets during authored document restore.

#### Scenario: Rebuild imported STEP body
- **WHEN** the authored history cursor includes a STEP import feature
- **THEN** the OCC adapter reads the referenced asset bytes in the worker/runtime rebuild path
- **AND** it registers produced bodies through the same topology tracking used by native solid features

### Requirement: OCC performance telemetry SHALL be captured at the worker operation boundary
The browser OCC runtime SHALL record sampled performance spans for kernel-facing operations at the OCC worker/client operation boundary rather than inside individual OCC feature functions, topology helpers, or mesh builders.

#### Scenario: Worker operation completes successfully
- **WHEN** the main thread invokes an OCC worker operation such as warmup, snapshot, sketch commit, feature mutation, preview evaluation, native topology payload building, or export payload building
- **THEN** performance telemetry records one span for the worker operation
- **AND** the span identifies the operation kind with low-cardinality attributes

#### Scenario: Worker operation fails
- **WHEN** an OCC worker operation returns a structured failure or rejects
- **THEN** performance telemetry records the failed operation classification when possible
- **AND** the original worker failure continues through the existing modeling or application error path

#### Scenario: Kernel internals perform repeated work
- **WHEN** an OCC worker operation internally visits many shapes, builds many mesh buffers, or performs multiple native calls
- **THEN** performance telemetry does not emit per-shape, per-buffer, per-face, per-edge, or per-native-call spans

