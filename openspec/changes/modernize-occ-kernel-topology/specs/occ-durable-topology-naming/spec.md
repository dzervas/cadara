## MODIFIED Requirements

### Requirement: OCC topology naming SHALL use kernel-owned identity internally
The OCC adapter SHALL maintain internal kernel-owned topology identity for body topology during committed rebuilds and SHALL use that identity plus kernel operation history to resolve durable body, face, edge, and vertex references against the current rebuilt OCC shapes.

#### Scenario: Initial body topology receives kernel identities
- **WHEN** the OCC adapter creates a new solid body from an authored feature
- **THEN** the adapter records the body and its faces, edges, and vertices with kernel-owned topology identity
- **AND** the public snapshot exposes durable typed references without exposing graph handles, OCAF labels, or OCC pointer identities

#### Scenario: Replacement topology is reconciled through kernel history
- **WHEN** a later feature replaces a body shape
- **THEN** the adapter uses kernel topology identity and operation history to map previous durable topology references to current subshapes before assigning fresh ids to new topology
- **AND** the mapping does not depend on incidental JS traversal order

#### Scenario: Naming details remain private
- **WHEN** the frontend reads snapshots, render bindings, diagnostics, or operation history
- **THEN** those payloads contain public durable references and diagnostics only
- **AND** they do not expose `TDF_Label`, `TNaming_NamedShape`, BRepGraph handles, OCAF document handles, or OCC pointer identities

### Requirement: Stable topology references SHALL survive unique OCC successors
The OCC adapter SHALL keep a previous durable topology reference live when kernel-owned topology identity and history resolve the previous subshape to exactly one current subshape of the same target kind in the final rebuilt body.

#### Scenario: Untouched face survives top-side joins
- **WHEN** a base block is joined with boss and rib features on its top side
- **THEN** a durable reference to the original bottom face remains live after the joins
- **AND** resolving that face returns the current bottom face on the final body

#### Scenario: Downstream plane uses pre-join face reference
- **WHEN** a plane feature references a planar face selected before subsequent joined booleans
- **THEN** the OCC rebuild resolves that pre-join face reference through kernel-owned topology identity and history
- **AND** the plane feature commits or rebuilds without a missing-face diagnostic

#### Scenario: Same-domain simplification carries selected edge
- **WHEN** a join operation extends a body through same-domain simplification
- **THEN** a durable reference to a selected vertical edge resolves to the unique simplified successor edge
- **AND** a downstream fillet using the pre-simplification edge reference can rebuild

#### Scenario: Stable references survive document rebuild
- **WHEN** a persisted authored document containing booleans and downstream face or edge references is reloaded and rebuilt from authored history
- **THEN** the same durable references resolve to equivalent current topology without relying on incidental traversal order

## ADDED Requirements

### Requirement: Topology naming SHALL migrate from temporary shim to OCCT 8 graph identity
The durable topology naming implementation SHALL treat the pre-8.0 shim as temporary and SHALL migrate to OCCT 8/BRepGraph identity and graph history when that runtime path is adopted.

#### Scenario: Pre-8.0 shim resolves topology
- **WHEN** the adapter uses a native shim around pre-8.0 OCCT naming, topology, and history APIs
- **THEN** the shim is documented in code as temporary bridge work
- **AND** the implementation tracks removal of the shim after OCCT 8/BRepGraph topology identity is available

#### Scenario: BRepGraph identity is available
- **WHEN** the OCC runtime exposes usable BRepGraph persistent identity and graph history
- **THEN** durable topology naming uses BRepGraph identity and history as the authoritative source
- **AND** the temporary pre-8.0 shim is removed rather than kept as a compatibility fallback
