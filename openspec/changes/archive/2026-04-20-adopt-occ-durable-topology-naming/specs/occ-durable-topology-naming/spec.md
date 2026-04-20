## ADDED Requirements

### Requirement: OCC topology naming SHALL use OCAF/TNaming internally
The OCC adapter SHALL maintain internal OCAF/TNaming naming state for body topology during committed rebuilds and SHALL use that state to resolve durable body, face, edge, and vertex references against the current rebuilt OCC shapes.

#### Scenario: Initial body topology receives names
- **WHEN** the OCC adapter creates a new solid body from an authored feature
- **THEN** the adapter records the body and its faces, edges, and vertices in the internal OCAF/TNaming naming state
- **AND** the public snapshot exposes durable typed references without exposing OCAF labels

#### Scenario: Replacement topology is reconciled through naming
- **WHEN** a later feature replaces a body shape
- **THEN** the adapter uses OCC naming and operation history to map previous durable topology references to current subshapes before assigning fresh ids to new topology

#### Scenario: Naming details remain private
- **WHEN** the frontend reads snapshots, render bindings, diagnostics, or operation history
- **THEN** those payloads contain public durable references and diagnostics only
- **AND** they do not expose `TDF_Label`, `TNaming_NamedShape`, OCAF document handles, or OCC pointer identities

### Requirement: Stable topology references SHALL survive unique OCC successors
The OCC adapter SHALL keep a previous durable topology reference live when OCAF/TNaming resolves the previous subshape to exactly one current subshape of the same target kind in the final rebuilt body.

#### Scenario: Untouched face survives top-side joins
- **WHEN** a base block is joined with boss and rib features on its top side
- **THEN** a durable reference to the original bottom face remains live after the joins
- **AND** resolving that face returns the current bottom face on the final body

#### Scenario: Downstream plane uses pre-join face reference
- **WHEN** a plane feature references a planar face selected before subsequent joined booleans
- **THEN** the OCC rebuild resolves that pre-join face reference through topology naming
- **AND** the plane feature commits or rebuilds without a missing-face diagnostic

#### Scenario: Same-domain simplification carries selected edge
- **WHEN** a join operation extends a body through same-domain simplification
- **THEN** a durable reference to a selected vertical edge resolves to the unique simplified successor edge
- **AND** a downstream fillet using the pre-simplification edge reference can rebuild

#### Scenario: Stable references survive document rebuild
- **WHEN** a persisted authored document containing booleans and downstream face or edge references is reloaded and rebuilt from authored history
- **THEN** the same durable references resolve to equivalent current topology without relying on incidental traversal order

### Requirement: Topology naming SHALL invalidate deleted or ambiguous references explicitly
The OCC adapter SHALL invalidate durable topology references when OCAF/TNaming determines that the target was deleted or cannot choose a unique current successor.

#### Scenario: Cut deletes referenced face
- **WHEN** a subtract or shell operation removes a face that a later feature references
- **THEN** rebuild reports the reference as invalid with a topology-deleted reason
- **AND** it does not remap the reference to a different surviving face

#### Scenario: Split creates ambiguous successors
- **WHEN** an operation splits a previously referenced face or edge into multiple plausible successor subshapes
- **THEN** rebuild reports the reference as invalid with an ambiguous-topology reason
- **AND** it does not choose a successor by enumeration order

#### Scenario: Consumed tool body topology is invalidated
- **WHEN** a Combine operation consumes a tool body into a target body result
- **THEN** durable topology references owned by the consumed tool body are reported as invalid
- **AND** they are not rebound to unrelated topology on the target result

### Requirement: Topology naming regression tests SHALL cover stable, deleted, and ambiguous cases
The default Bun test suite SHALL include topology naming regression coverage for the OCC adapter.

#### Scenario: Existing limitation tests are promoted
- **WHEN** `bun run test` executes
- **THEN** it runs coverage equivalent to the previous topological naming limitation tests for untouched faces, downstream planes, and same-domain edge fillets

#### Scenario: Additional stable-reference tests exist
- **WHEN** `bun run test` executes
- **THEN** it verifies that unique-successor face and edge references survive boolean joins, same-domain simplification, and full authored-document rebuild

#### Scenario: Additional invalid-reference tests exist
- **WHEN** `bun run test` executes
- **THEN** it verifies that deleted and ambiguous topology references produce explicit invalid-reference diagnostics instead of silent remapping
