## MODIFIED Requirements

### Requirement: OCC-backed revolve features support preview and committed rebuilds
The system SHALL allow revolve features backed by the OpenCascade adapter to evaluate previews and create or update committed features when the request uses valid solid or surface profile inputs and a durable supported axis.

#### Scenario: Preview a valid solid revolve
- **WHEN** the user evaluates a solid revolve preview from a valid sketch region or planar face with a durable edge axis and a valid angular extent
- **THEN** the adapter returns fresh transient solid renderables and no error diagnostics

#### Scenario: Commit a valid solid revolve
- **WHEN** the user creates or updates a solid revolve feature from a valid sketch region or planar face with a durable edge axis and a valid angular extent
- **THEN** the adapter accepts the revision, rebuilds the model, and reports the produced solid body targets in the committed result

#### Scenario: Preview a valid surface revolve
- **WHEN** the user evaluates a surface revolve preview from a valid region, planar face, or connected open sketch-curve wire with a supported durable axis and valid angular extent
- **THEN** the adapter returns fresh transient sheet renderables and no error diagnostics

#### Scenario: Commit a valid surface revolve
- **WHEN** the user creates or updates a surface revolve feature from a valid region, planar face, or connected open sketch-curve wire with a supported durable axis and valid angular extent
- **THEN** the adapter accepts the revision, rebuilds the model, and reports the produced sheet body target in the committed result

#### Scenario: Reject an unsupported construction-backed axis
- **WHEN** a revolve request references a construction-backed axis that the public contract does not define precisely enough to reconstruct
- **THEN** the adapter rejects the request with structured diagnostics instead of inventing hidden axis semantics

### Requirement: Solid features apply explicit boolean scope semantics during rebuild
The system SHALL apply explicit boolean operation and boolean-scope semantics for supported solid-producing features, including solid extrude, solid revolve, and shell, rather than relying on implicit target selection; surface-producing features SHALL bypass boolean scope by contract.

#### Scenario: Standalone operation creates a new body
- **WHEN** a solid-producing feature uses `operation: newBody` with `booleanScope.kind: standalone`
- **THEN** the rebuild produces a new committed solid body without attempting boolean participation with existing bodies

#### Scenario: Multi-body join preserves first target identity
- **WHEN** a solid-producing feature uses a join operation with `booleanScope.kind: targetBodies` and an ordered list of target body ids
- **THEN** the rebuild follows the documented multi-body boolean policy and preserves the first target body's identity for the joined result

#### Scenario: Multi-body cut or intersect respects explicit target scope
- **WHEN** a solid-producing feature uses cut or intersect with explicit target body ids
- **THEN** the rebuild applies the operation only to the declared target bodies and returns diagnostics or dropped results according to the documented boolean policy

#### Scenario: Surface feature has no boolean scope
- **WHEN** a surface extrude or surface revolve is rebuilt
- **THEN** the adapter creates a new sheet body without reading boolean operation or boolean-scope fields

### Requirement: OCC-backed extrude SHALL execute advanced end conditions
The OpenCascade adapter SHALL preview, commit, and rebuild extrude features using advanced end conditions and explicit extent modes for both solid and supported surface result variants.

#### Scenario: OCC executes up-to-next extrude
- **WHEN** an extrude preview or commit uses `upToNext`
- **THEN** the adapter determines the next terminating face or faces in the extrude direction and builds the resulting geometry
- **AND** if the feature cannot completely terminate, the adapter returns structured diagnostics instead of committing a partial result

#### Scenario: OCC executes up-to extrude with offset
- **WHEN** an extrude preview or commit uses an up-to end condition with an offset
- **THEN** the adapter terminates against the requested up-to geometry and applies the authored offset in the requested offset direction
- **AND** if the offset makes the result impossible or ambiguous, the adapter returns structured diagnostics instead of committing a partial result

#### Scenario: OCC executes through-all extrude
- **WHEN** an extrude preview or commit uses `throughAll`
- **THEN** the adapter builds an extent that pierces all applicable geometry in front of the profile along the extrude direction

#### Scenario: OCC executes drafted two-side solid extrude
- **WHEN** a solid extrude preview or commit uses `twoSide` with draft on one or both ends
- **THEN** the adapter builds both extents with their own authored end and draft values

#### Scenario: OCC rejects drafted surface extrude
- **WHEN** a surface extrude preview or commit includes a draft angle or other tapered-cap-irrelevant draft state
- **THEN** the adapter rejects the request with an explicit unsupported-surface-draft diagnostic before attempting geometry execution

### Requirement: OCC-backed revolve SHALL execute advanced end conditions
The OpenCascade adapter SHALL preview, commit, and rebuild revolve features using full, blind, and up-to angular end conditions for both solid and supported surface result variants.

#### Scenario: OCC executes full solid revolve
- **WHEN** a solid revolve preview or commit uses full revolve
- **THEN** the adapter revolves the selected profile 360 degrees around the explicit axis and tracks a solid result

#### Scenario: OCC executes full surface revolve
- **WHEN** a surface revolve preview or commit uses full revolve
- **THEN** the adapter revolves the selected wire or profile 360 degrees around the explicit axis and tracks a sheet result

#### Scenario: OCC executes up-to revolve
- **WHEN** a revolve preview or commit uses an up-to end condition
- **THEN** the adapter computes angular termination around the explicit axis and either builds the resulting geometry or returns a structured diagnostic for ambiguous or impossible termination

#### Scenario: OCC executes up-to revolve with offset
- **WHEN** a revolve preview or commit uses an up-to end condition with angular offset
- **THEN** the adapter computes angular termination around the explicit axis and applies the authored offset before building the result

### Requirement: Advanced extent results SHALL preserve durable modeling behavior
Advanced extrude and revolve previews, commits, rebuilds, snapshots, and edit hydration SHALL preserve feature identity, produced targets, result body type, body kind, boolean scope behavior for solid variants, and topology diagnostics consistently with existing basic feature operations.

#### Scenario: Advanced solid extent feature is edited
- **WHEN** the user edits an existing advanced solid extrude or revolve feature
- **THEN** the editor hydrates the original result body type, extent mode, end conditions, draft values, targets, operation, and boolean scope from the durable feature definition

#### Scenario: Advanced surface extent feature is edited
- **WHEN** the user edits an existing advanced surface extrude or revolve feature
- **THEN** the editor hydrates the original result body type, extent mode, end conditions, profiles, and sheet body result without operation or boolean-scope fields

#### Scenario: Advanced extent feature rebuilds after history replay
- **WHEN** operation history replays an advanced extrude or revolve feature
- **THEN** the adapter rebuilds from the authored extent and result-body contract rather than inferred UI state

## ADDED Requirements

### Requirement: OCC-backed surface extrude SHALL sweep wires into sheet bodies
The OpenCascade adapter SHALL execute surface extrude by building wires from valid profile refs, sweeping those wires with the existing prism path, and tracking exactly one sheet body result.

#### Scenario: Surface extrude uses a closed region
- **WHEN** a surface extrude uses a closed sketch region or planar-face profile
- **THEN** the adapter builds the boundary wire and skips `BRepBuilderAPI_MakeFace_15`
- **AND** the prism operation produces a sheet body rather than a solid cap volume

#### Scenario: Surface extrude uses open sketch curves
- **WHEN** a surface extrude uses durable open sketch-curve refs that form one connected chain
- **THEN** the adapter groups the entities into a wire with `BRepBuilderAPI_MakeWire`
- **AND** the prism operation sweeps that wire into one sheet body

#### Scenario: Surface extrude produces no sheet
- **WHEN** surface extrude geometry execution produces no shell or sheet-trackable shape
- **THEN** the adapter returns a structured no-sheet-result diagnostic instead of committing a feature

#### Scenario: Surface extrude produces multiple sheets
- **WHEN** surface extrude geometry execution produces multiple disconnected shell or sheet-trackable shapes
- **THEN** the adapter returns a structured multi-sheet-result diagnostic instead of choosing one result

### Requirement: OCC-backed surface revolve SHALL sweep wires into sheet bodies
The OpenCascade adapter SHALL execute surface revolve by revolving valid profile wires around the explicit axis and tracking exactly one sheet body result.

#### Scenario: Surface revolve uses a closed region
- **WHEN** a surface revolve uses a closed sketch region or planar-face profile
- **THEN** the adapter builds the boundary wire and revolves the wire without constructing a solid face input
- **AND** the revolve operation produces a sheet body rather than a solid volume

#### Scenario: Surface revolve uses open sketch curves
- **WHEN** a surface revolve uses durable open sketch-curve refs that form one connected chain
- **THEN** the adapter groups the entities into a wire with `BRepBuilderAPI_MakeWire`
- **AND** the revolve operation sweeps that wire into one sheet body

#### Scenario: Surface revolve produces an unexpected solid
- **WHEN** surface revolve geometry execution produces a solid result for a `resultBodyType: "surface"` request
- **THEN** the adapter returns a structured result-shape-mismatch diagnostic instead of tracking the solid

### Requirement: Surface extrude and revolve SHALL preserve sheet provenance
OCC-backed surface extrude and revolve SHALL preserve durable feature identity and topology naming with sheet-specific source keys.

#### Scenario: Surface result is committed
- **WHEN** a surface extrude or surface revolve is committed successfully
- **THEN** the committed result records the produced target as a sheet body owned by the feature

#### Scenario: Boundary topology is named
- **WHEN** a surface extrude or surface revolve creates first or last boundary edges
- **THEN** topology naming uses sheet-specific boundary-edge source keys rather than solid cap-face keys
