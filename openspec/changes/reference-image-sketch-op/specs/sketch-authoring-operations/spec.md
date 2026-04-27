## MODIFIED Requirements

### Requirement: Sketch definitions SHALL persist authoring operations
The sketch authored contract SHALL persist an ordered collection of sketch authoring operations alongside the flat sketch graph. Each operation SHALL identify the accepted user intent, carry a durable operation id and display label, and reference the graph members it created, removed, replaced, or edited. Explicitly approved operation kinds MAY also persist operation-owned state that is not represented as ordinary local sketch graph records.

#### Scenario: Constructor operation is persisted
- **WHEN** the user completes a rectangle constructor in an active sketch
- **THEN** the sketch definition contains one durable authoring operation for that rectangle
- **AND** that operation references the flat points, line entities, constraints, and dimensions created by the constructor

#### Scenario: Operation metadata survives save and reopen
- **WHEN** a document containing a sketch with authoring operations is saved and reopened
- **THEN** the reopened sketch definition exposes the same ordered authoring operations
- **AND** operation rows retain their durable operation ids and display labels

#### Scenario: Reference-image operation persists operation-owned state
- **WHEN** the user creates a committed `referenceImage` operation
- **THEN** the sketch definition persists that operation in the authoring operation list
- **AND** the operation may own image-specific persisted state without translating that state into local sketch points, entities, or constraints

### Requirement: Authoring operations SHALL be metadata over a flat sketch graph
Sketch authoring operations SHALL remain distinct from the flat local sketch graph. The current flat sketch graph SHALL remain the source of truth for local solver input, region extraction, and local sketch geometry editing. Explicitly approved special operations MAY own isolated operation-local state for rendering or dedicated editing workflows without materializing that state as local sketch geometry.

#### Scenario: Solver ignores operation-owned image payload
- **WHEN** a sketch contains a committed `referenceImage` operation with operation-owned image data
- **THEN** the local sketch solver receives no image-owned local sketch points, entities, or constraints from that operation

#### Scenario: Complex operation is not re-derived
- **WHEN** a sketch contains four line entities and constraints that geometrically resemble a rectangle but no rectangle authoring operation
- **THEN** the system does not synthesize a rectangle operation by inspecting the flat graph

#### Scenario: Reference-image operation is not rebuilt from local graph records
- **WHEN** a sketch contains a committed `referenceImage` operation
- **THEN** the system reads that image operation from its own persisted operation state
- **AND** it does not infer the image operation by reconstructing hidden local sketch geometry
