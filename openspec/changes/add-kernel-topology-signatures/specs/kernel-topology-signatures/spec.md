## ADDED Requirements

### Requirement: The kernel SHALL expose per-entity geometric signatures derived from native payloads
The system SHALL derive geometric signatures — entity class, geometry type, defining data where cheap (plane origin/normal, cylinder axis/radius, line origin/direction, circle center/radius), centroid approximation, and bounding box — for faces, edges, and vertices of committed kernel bodies, keyed by their durable topology references, using the native exact-B-rep and topology payloads rather than per-entity JS-side OCC traversal.

#### Scenario: Planar face signature
- **WHEN** a signature is requested for a planar face
- **THEN** the signature reports geometry type plane with origin and normal, plus bounding box and centroid approximation
- **AND** the signature is keyed by the face's durable topology reference

#### Scenario: Cylindrical face and circular edge signatures
- **WHEN** signatures are requested for a cylindrical face or a circular edge
- **THEN** they carry axis/radius (cylinder) or center/radius/axis (circle) defining data

#### Scenario: Unsupported geometry type
- **WHEN** an entity's underlying geometry has no cheap defining-data mapping (e.g. a free-form surface)
- **THEN** the signature still reports entity class, a generic geometry type, bounding box, and centroid approximation
- **AND** no defining data is fabricated

#### Scenario: Payload lacks required records
- **WHEN** the loaded kernel build does not populate the exact-B-rep records needed for signature derivation
- **THEN** signature extraction reports a structured capability diagnostic
- **AND** dependent capabilities register as absent rather than degrading silently

### Requirement: History evaluation SHALL run in an isolated kernel session
The system SHALL rebuild candidate action sequences for signature probing in a sandboxed kernel session that leaves no trace: no authored document mutation, no operation history or undo entries, no persisted caches, and no cross-contamination with concurrently open documents.

#### Scenario: Probe leaves no trace
- **WHEN** a probe rebuilds a candidate sequence while a document is open
- **THEN** the open document's state, history, undo stack, and derived caches are byte-identical to their pre-probe state

#### Scenario: Per-step results
- **WHEN** a probed sequence completes
- **THEN** the result carries, per step, the signatures of the topology produced or modified by that step

#### Scenario: Step failure inside the sandbox
- **WHEN** a step fails to rebuild in the sandboxed session
- **THEN** the probe returns the completed prefix results and structured diagnostics for the failing step
- **AND** the failure does not affect any state outside the session

### Requirement: The import history probe SHALL be available on OCC-backed platforms
The system SHALL wire the sandboxed session and signature extraction as the `ImportCapabilities` history evaluation probe in platform capability composition, replacing explicit absence wherever the OCC kernel is available.

#### Scenario: Probe present in the browser app
- **WHEN** import capabilities are composed for the OCC-backed browser platform
- **THEN** the history evaluation probe is present and backed by the sandboxed kernel session

#### Scenario: Probe-present import behavior activates
- **WHEN** an Onshape capture bundle is imported on a probe-equipped platform
- **THEN** signature matching and ground-truth deviation verification run per the Onshape provider's probe-present scenarios
- **AND** features previously planned as `baked` solely for the capability reason code become eligible for `parametric` planning

#### Scenario: Kernel build without required payloads
- **WHEN** the loaded kernel build cannot supply signature extraction
- **THEN** the probe registers as explicitly absent per the import provider contract
- **AND** no stub fabricates signatures
