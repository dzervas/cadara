## ADDED Requirements

### Requirement: Onshape construction planes SHALL translate to parametric plane features
The provider SHALL translate an Onshape `cPlane` history entry into a cadara `plane` feature at the `parametric` tier when the plane's geometry is recoverable from the bundle (captured reference signature, supported offset/coplanar parameters) or from probe-rebuilt topology, and SHALL record a reason code naming the recovery source. A `cPlane` whose geometry cannot be recovered SHALL stay `baked` with the existing degradation reporting.

#### Scenario: cPlane with a captured planar reference translates
- **WHEN** a `cPlane` entry's defining reference resolves to a captured planar face signature with origin and normal
- **THEN** the plan marks the entry `parametric` and prepare emits a `plane` feature action whose definition reproduces the captured frame
- **AND** the reason code identifies the captured-frame recovery source

#### Scenario: Unrecoverable cPlane stays baked
- **WHEN** a `cPlane` entry's defining geometry cannot be recovered from capture or probe
- **THEN** the plan marks it `baked` with a reason code identifying the unrecoverable input
- **AND** its dependent sketches degrade through the existing bake cascade

### Requirement: Sketch supports on translated planes SHALL resolve through deferred construction references
The provider SHALL make a sketch placed on a translated Onshape construction plane reference that plane through a deferred construction reference to the plane feature's prepared action, resolved by the orchestrator at apply time. The provider SHALL NOT emit any sketch-plane support that does not resolve to a construction or face the prepared-action sequence creates or the document already contains.

#### Scenario: Sketch on a translated cPlane commits parametrically
- **WHEN** the ordered actions contain a translated `plane` feature followed by a sketch commit whose plane support is a deferred construction reference to it
- **THEN** the orchestrator substitutes the construction id the plane feature produced before applying the sketch commit
- **AND** the committed sketch's support resolves in the kernel authoring state

#### Scenario: No fabricated construction supports ship
- **WHEN** prepare completes for any studio
- **THEN** no prepared sketch commit carries a construction support id that no prepared action produces
- **AND** a sketch whose plane cannot be legitimately referenced degrades to `baked` instead
