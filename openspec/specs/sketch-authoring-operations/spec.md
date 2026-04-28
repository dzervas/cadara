# sketch-authoring-operations Specification

## Purpose
Defines how sketches persist ordered authoring operations alongside the live flat sketch graph, including limited operation-owned state for approved special cases.

## Requirements
### Requirement: Sketch definitions SHALL persist authoring operations
The sketch authored contract SHALL persist an ordered collection of sketch authoring operations alongside the flat sketch graph. Each operation SHALL identify the accepted user intent, carry a durable operation id and display label, and reference the graph members it created, removed, replaced, or edited. Explicitly approved operation kinds MAY also persist operation-owned state that is not represented as ordinary local sketch graph records, but that operation-owned state SHALL reference flat-graph members explicitly when the feature depends on local sketch geometry.

#### Scenario: Constructor operation is persisted
- **WHEN** the user completes a rectangle constructor in an active sketch
- **THEN** the sketch definition contains one durable authoring operation for that rectangle
- **AND** that operation references the flat points, line entities, constraints, and dimensions created by the constructor

#### Scenario: Operation metadata survives save and reopen
- **WHEN** a document containing a sketch with authoring operations is saved and reopened
- **THEN** the reopened sketch definition exposes the same ordered authoring operations
- **AND** operation rows retain their durable operation ids and display labels

#### Scenario: Reference-image operation persists operation-owned state
- **WHEN** the user creates or edits a committed `referenceImage` operation
- **THEN** the sketch definition persists that operation in the authoring operation list
- **AND** the operation may own image-specific persisted state, including anchor-binding metadata that references durable local sketch point ids, without translating the image payload itself into local sketch entities

### Requirement: Authoring operations SHALL be metadata over a flat sketch graph
Sketch authoring operations SHALL remain distinct from the flat local sketch graph. The current flat sketch graph SHALL remain the source of truth for local solver input, region extraction, and local sketch geometry editing. Explicitly approved special operations MAY own isolated operation-local state for rendering or dedicated editing workflows without materializing that state as local sketch geometry, but any local geometry that drives those operations SHALL still live in the flat graph and participate in the normal sketch solver.

#### Scenario: Solver ignores operation-owned image payload
- **WHEN** a sketch contains a committed `referenceImage` operation with operation-owned image data
- **THEN** the local sketch solver receives no image-owned local sketch points, entities, or constraints from that operation

#### Scenario: Complex operation is not re-derived
- **WHEN** a sketch contains four line entities and constraints that geometrically resemble a rectangle but no rectangle authoring operation
- **THEN** the system does not synthesize a rectangle operation by inspecting the flat graph

#### Scenario: Reference-image operation is not rebuilt from local graph records
- **WHEN** a sketch contains a committed `referenceImage` operation with bound calibration anchor point ids
- **THEN** the system reads that image operation from its own persisted operation state
- **AND** it does not infer the image payload or anchor metadata by reconstructing hidden image-owned geometry

### Requirement: Deleted sketch graph members SHALL be absent from current document state
When a sketch operation deletes geometry, constraints, or dimensions, the deleted members SHALL be removed from the current flat sketch graph and SHALL NOT participate in solver input, rendering, picking, selection, commit payloads, or active document state. Prior authoring operations MAY retain historical references to the deleted member ids.

#### Scenario: Constraint is added, deleted, and added again
- **WHEN** the user adds a constraint, deletes that constraint, and then adds an equivalent constraint again
- **THEN** the current sketch graph contains only the newly added live constraint
- **AND** the deleted constraint does not participate in the current solver input or commit payload
- **AND** the durable operation history still records the add, delete, and second add operations in order

#### Scenario: Rectangle geometry is deleted and recreated
- **WHEN** the user creates a rectangle, deletes all geometry created by that rectangle, and then creates another rectangle
- **THEN** the current sketch graph contains only the live geometry from the second rectangle
- **AND** the durable operation history still contains the first rectangle operation, the delete operation, and the second rectangle operation

### Requirement: Deletions SHALL append authoring operations
Ordinary deletion of sketch geometry, constraints, dimensions, or annotations SHALL append a new sketch authoring operation instead of mutating or removing the original operation that created the deleted members.

#### Scenario: Delete one edge from a rectangle
- **WHEN** the user deletes one edge created by a rectangle operation
- **THEN** the sketch definition removes that edge and dependent live constraints or dimensions from the current flat graph
- **AND** the authoring operation list appends a delete operation after the rectangle operation
- **AND** the original rectangle operation remains available as historical metadata

### Requirement: Explicit operation edits SHALL update the edited operation
When the user explicitly edits an existing sketch authoring operation, the system SHALL update the targeted operation metadata and corresponding live graph records instead of appending an unrelated delete/add operation.

#### Scenario: Edit rectangle width through the operation
- **WHEN** the user changes a rectangle width through an explicit operation or dimension edit for that rectangle
- **THEN** the rectangle authoring operation is updated to reflect the edited value
- **AND** the corresponding live dimension or graph records are updated in the current flat sketch graph
- **AND** no delete operation is appended for the edited width change

### Requirement: Inferred constraints SHALL belong to the accepted operation
Constraints inferred from accepted snap or constructor intent SHALL be recorded as members of the same authoring operation that accepted the user action. Manually created constraints or dimensions SHALL be recorded as their own authoring operations.

#### Scenario: Snapped line creates inferred coincident constraint
- **WHEN** the user creates a line whose accepted snap creates an inferred coincident constraint
- **THEN** the line authoring operation references both the line geometry and the inferred constraint
- **AND** a single sketch undo step before that operation removes both the line geometry and the inferred constraint from the visible sketch state

#### Scenario: Manual constraint is separate operation
- **WHEN** the user manually adds a coincident constraint to existing sketch geometry
- **THEN** the sketch definition appends a separate constraint authoring operation
- **AND** that operation references the created constraint or dimension records
