# durable-modeling-contract Specification

## Purpose
TBD - created by archiving change formalize-kernel-adapter-boundary. Update Purpose after archive.
## Requirements
### Requirement: Durable CAD references are explicit and typed
The CAD modeling contract SHALL identify documents, features, sketches, constructions, bodies, faces, edges, vertices, and sketch primitives through explicit typed references rather than incidental array order or ambiguous positional selection.

#### Scenario: Frontend addresses a consumed primitive
- **WHEN** a request references a body, face, edge, vertex, sketch entity, region, or construction
- **THEN** the request carries an explicit typed reference that identifies the durable target without relying on UI ordering or "first/second" positional meaning

#### Scenario: Topology changes invalidate a reference
- **WHEN** a topology-changing operation destroys or replaces a previously referenced primitive
- **THEN** the contract reports the invalid reference explicitly through diagnostics or invalid-reference reporting instead of silently remapping it to a surviving primitive

### Requirement: Modeling contract payloads are versioned
The modeling contract SHALL include explicit versioning for request/response payloads and committed snapshot schemas so contract evolution does not depend on undocumented breaking changes, and boundary implementations SHALL reject unsupported or malformed versioned payloads explicitly through runtime validation.

#### Scenario: Client submits a modeling request
- **WHEN** the frontend issues a modeling request to the public modeling contract
- **THEN** the payload includes the documented contract version required by that request family

#### Scenario: Client reads committed model state
- **WHEN** the frontend reads a document snapshot or feature definition from the public modeling contract
- **THEN** the returned data includes the documented schema or feature-type version needed to interpret it

#### Scenario: Snapshot uses an unsupported schema version
- **WHEN** the frontend boundary receives a snapshot payload whose declared schema version is not supported
- **THEN** the boundary rejects that payload explicitly with a validation failure that identifies the schema-version mismatch

#### Scenario: Contract payload is structurally malformed
- **WHEN** the frontend boundary receives a modeling payload that is missing required top-level fields or uses invalid discriminants
- **THEN** the boundary rejects that payload explicitly instead of partially normalizing it through ad hoc field checks

### Requirement: Feature previews are correlated and non-mutating
The modeling contract SHALL evaluate feature previews as correlated requests tied to a document revision and SHALL keep preview evaluation separate from committed document state.

#### Scenario: Preview response arrives for the current revision
- **WHEN** the frontend evaluates a feature preview against a base document revision
- **THEN** the response includes correlation information for that request and returns preview geometry and diagnostics without committing document changes

#### Scenario: Stale preview response arrives
- **WHEN** a preview response is returned for an outdated request or base revision
- **THEN** the response is safely discardable by the caller based on its correlation and revision information

### Requirement: Render exports round-trip to durable semantic targets
The modeling contract SHALL export renderable geometry with bindings back to durable semantic references so viewport picking, highlighting, and selection can resolve to the same typed targets used elsewhere in the contract.

#### Scenario: User picks geometry in the viewport
- **WHEN** the user selects or highlights a rendered face, edge, vertex, sketch primitive, or construction in the viewport
- **THEN** the render export metadata resolves that pick back to the corresponding typed durable reference

#### Scenario: Primary selection click does not match a durable target
- **WHEN** the user left clicks renderable geometry in the primary viewport and the system cannot resolve a durable semantic reference from the render binding
- **THEN** the contract reports the unresolved pick through diagnostics or selection failure handling rather than failing silently or guessing a target

#### Scenario: Snapshot is used to build scene and selection UX
- **WHEN** the frontend renders tree rows, object rows, and viewport geometry from a document snapshot
- **THEN** it can derive those views from explicit snapshot and render-binding data without guessing ownership from array positions

### Requirement: Durable feature definitions SHALL persist authored wrappers for eligible feature editor values
The modeling contract SHALL persist eligible non-reference feature editor values as authored wrappers that distinguish typed literal values from raw expression text.

#### Scenario: Literal-valued feature is committed
- **WHEN** a feature with eligible literal-valued editor fields is committed under the expression-capable feature schema
- **THEN** the durable feature definition stores those fields as literal authored values

#### Scenario: Expression-valued feature is committed
- **WHEN** a feature with eligible expression-valued editor fields is committed
- **THEN** the durable feature definition stores the raw expression text for those fields
- **AND** the durable feature definition does not store the resolved value for those fields

### Requirement: Modeling execution SHALL consume resolved feature definitions
The modeling contract SHALL provide or derive resolved concrete feature definitions before invoking solver, mock kernel, OpenCascade, or low-level geometry execution.

#### Scenario: Kernel executes an expression-authored feature
- **WHEN** a committed or preview feature contains expression-authored values
- **THEN** the modeling boundary resolves those values to concrete typed parameters before invoking kernel execution
- **AND** the kernel feature execution path receives concrete parameter types equivalent to the pre-expression contract

#### Scenario: Resolution diagnostics prevent execution
- **WHEN** an authored feature definition contains a value expression that fails resolution or value-kind validation
- **THEN** the modeling boundary returns diagnostics for that authored value
- **AND** it does not invoke kernel feature execution for that invalid definition

### Requirement: Legacy literal feature payloads SHALL normalize deliberately
The modeling contract SHALL handle pre-expression literal feature payloads only through explicit schema-versioned normalization or migration into literal authored wrappers.

#### Scenario: Legacy feature payload is loaded
- **WHEN** persistence or history replay loads a supported pre-expression feature definition
- **THEN** contract normalization converts eligible literal fields into literal authored wrappers
- **AND** unsupported malformed payloads are still rejected by runtime validation

#### Scenario: New feature payload is persisted
- **WHEN** a feature definition is persisted after this change
- **THEN** eligible non-reference feature editor values use the canonical authored wrapper shape

