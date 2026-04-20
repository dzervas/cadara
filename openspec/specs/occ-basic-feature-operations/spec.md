# occ-basic-feature-operations Specification

## Purpose
TBD - created by archiving change implement-occ-basic-feature-sessions. Update Purpose after archive.
## Requirements
### Requirement: OCC-backed revolve features support preview and committed rebuilds
The system SHALL allow revolve features backed by the OpenCascade adapter to evaluate previews and create or update committed features when the request uses a valid closed profile and a durable edge-backed axis.

#### Scenario: Preview a valid revolve
- **WHEN** the user evaluates a revolve preview from a valid sketch region or planar face with a durable edge axis and a valid angular extent
- **THEN** the adapter returns fresh transient renderables and no error diagnostics

#### Scenario: Commit a valid revolve
- **WHEN** the user creates or updates a revolve feature from a valid sketch region or planar face with a durable edge axis and a valid angular extent
- **THEN** the adapter accepts the revision, rebuilds the model, and reports the produced body targets in the committed result

#### Scenario: Reject an unsupported construction-backed axis
- **WHEN** a revolve request references a construction-backed axis that the public contract does not define precisely enough to reconstruct
- **THEN** the adapter rejects the request with structured diagnostics instead of inventing hidden axis semantics

### Requirement: OCC-backed fillet features mutate durable body topology
The system SHALL allow fillet features backed by the OpenCascade adapter to preview, create, and update edge-rounding operations against explicit durable edge references.

#### Scenario: Preview a valid fillet
- **WHEN** the user evaluates a fillet preview with one or more valid durable edge targets and a positive radius
- **THEN** the adapter returns transient renderables that reflect the requested rounded topology

#### Scenario: Commit a valid fillet
- **WHEN** the user creates a fillet with valid durable edge targets and a positive radius
- **THEN** the adapter rebuilds the owning body and later snapshots expose the updated topology instead of preserving the pre-fillet body shape

#### Scenario: Update a fillet radius
- **WHEN** the user updates an existing fillet feature with a different positive radius
- **THEN** the adapter rebuilds the feature and the resulting body topology reflects the new radius

### Requirement: OCC-backed plane features create durable construction planes from supported references
The system SHALL allow plane features backed by the OpenCascade adapter to create durable construction planes from supported coplanar reference seeds.

#### Scenario: Create a plane from a construction plane
- **WHEN** the user creates a coplanar plane from an existing durable construction plane reference
- **THEN** the adapter accepts the feature and produces a new durable construction target for the resulting plane

#### Scenario: Create a plane from a planar face
- **WHEN** the user creates a coplanar plane from a valid planar face reference
- **THEN** the adapter accepts the feature and produces a new durable construction target for the resulting plane

### Requirement: Shell features are part of the typed feature contract and OCC pipeline
The system SHALL expose shell as a typed feature definition and SHALL allow the OpenCascade-backed adapter to preview and commit shell operations against explicit durable face references and positive thickness inputs.

#### Scenario: Preview a shell feature
- **WHEN** the user evaluates a shell preview with a valid body target, one or more valid removable face references, and a positive thickness
- **THEN** the adapter returns transient shell geometry and any validation diagnostics in the standard preview response shape

#### Scenario: Commit a shell feature
- **WHEN** the user creates or updates a shell feature with valid face references and a positive thickness
- **THEN** the adapter accepts the revision, rebuilds the model, and reports the resulting committed body targets through the standard feature mutation response

### Requirement: Solid features apply explicit boolean scope semantics during rebuild
The system SHALL apply explicit boolean operation and boolean-scope semantics for supported solid-producing features, including extrude, revolve, and shell, rather than relying on implicit target selection.

#### Scenario: Standalone operation creates a new body
- **WHEN** a solid-producing feature uses `operation: newBody` with `booleanScope.kind: standalone`
- **THEN** the rebuild produces a new committed body without attempting boolean participation with existing bodies

#### Scenario: Multi-body join preserves first target identity
- **WHEN** a solid-producing feature uses a join operation with `booleanScope.kind: targetBodies` and an ordered list of target body ids
- **THEN** the rebuild follows the documented multi-body boolean policy and preserves the first target body's identity for the joined result

#### Scenario: Multi-body cut or intersect respects explicit target scope
- **WHEN** a solid-producing feature uses cut or intersect with explicit target body ids
- **THEN** the rebuild applies the operation only to the declared target bodies and returns diagnostics or dropped results according to the documented boolean policy

### Requirement: OCC-backed Combine SHALL execute body boolean operations
The OpenCascade-backed adapter SHALL preview, commit, and rebuild Combine add, subtract, and intersect operations against explicit durable body participants.

#### Scenario: OCC previews Combine add
- **WHEN** a Combine preview requests `add` with valid target and tool bodies
- **THEN** the adapter returns transient fused geometry and no failed diagnostic

#### Scenario: OCC commits Combine subtract
- **WHEN** a Combine commit requests `subtract` with valid target and tool bodies
- **THEN** the adapter rebuilds the owning body result by cutting the tool bodies from the target bodies
- **AND** the committed result is visible in the returned snapshot

#### Scenario: OCC commits Combine intersect
- **WHEN** a Combine commit requests `intersect` with valid target and tool bodies
- **THEN** the adapter rebuilds the result from the common volume of the selected bodies
- **AND** empty intersections are reported as diagnostics instead of successful no-op commits

#### Scenario: OCC rebuilds committed Combine after refresh
- **WHEN** a persisted document containing a committed Combine feature is rebuilt
- **THEN** the OCC adapter re-executes the Combine feature from its durable participant references and operation intent
- **AND** the rebuilt body output matches the committed feature order

### Requirement: OCC-backed topology-targeted features SHALL resolve named topology successors
OCC-backed features that consume durable face, edge, or vertex references SHALL resolve those references through the OCC topology naming layer before executing feature geometry.

#### Scenario: Plane references a face before later booleans
- **WHEN** a plane feature references a planar face that was selected before later boolean joins
- **THEN** the OCC adapter resolves the face to its current named successor before creating the plane
- **AND** the feature does not fail only because the body topology was replaced

#### Scenario: Fillet references an edge before same-domain simplification
- **WHEN** a fillet feature references an edge that was later carried through same-domain simplification
- **THEN** the OCC adapter resolves the edge to its unique current named successor before building the fillet

#### Scenario: Shell rejects a deleted face reference
- **WHEN** a shell feature references a face that earlier topology naming marked deleted
- **THEN** the OCC adapter rejects the feature with an invalid-reference diagnostic
- **AND** it does not apply the shell to a different surviving face

### Requirement: OCC-backed boolean operations SHALL preserve target topology where naming can prove continuity
OCC-backed extrude, revolve, shell, and Combine boolean operations SHALL preserve target body topology references through OCC naming when the final result contains a unique live successor.

#### Scenario: Join preserves unaffected target face
- **WHEN** a join operation adds material to one side of a target body
- **THEN** unaffected target faces and edges that OCC naming resolves uniquely remain live durable references after the join

#### Scenario: Subtract invalidates removed target topology
- **WHEN** a subtract operation removes a target face or edge
- **THEN** references to the removed topology are invalidated with a deleted-topology reason

#### Scenario: Intersect invalidates topology outside common volume
- **WHEN** an intersect operation removes target topology outside the common volume
- **THEN** references to removed target topology are invalidated instead of being rebound to unrelated common-volume topology
