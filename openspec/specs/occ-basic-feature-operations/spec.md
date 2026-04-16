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

