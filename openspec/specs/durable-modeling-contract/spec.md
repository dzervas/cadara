# durable-modeling-contract Specification

## Purpose
TBD - created by archiving change formalize-kernel-adapter-boundary. Update Purpose after archive.
## Requirements
### Requirement: Durable CAD references are explicit and typed
The CAD modeling contract SHALL identify documents, features, sketches, constructions, bodies, faces, edges, vertices, and sketch primitives through explicit typed references rather than incidental array order or ambiguous positional selection, and SHALL keep topology references live across topology-changing operations when the kernel can prove a unique current successor.

#### Scenario: Frontend addresses a consumed primitive
- **WHEN** a request references a body, face, edge, vertex, sketch entity, region, or construction
- **THEN** the request carries an explicit typed reference that identifies the durable target without relying on UI ordering or "first/second" positional meaning

#### Scenario: Topology changes preserve a uniquely resolved reference
- **WHEN** a topology-changing operation replaces a body but the kernel resolves a previous primitive reference to exactly one current successor
- **THEN** the contract continues to resolve that durable reference to the current primitive
- **AND** the result does not depend on incidental topology enumeration order

#### Scenario: Topology changes invalidate a destroyed reference
- **WHEN** a topology-changing operation destroys a previously referenced primitive and no current successor exists
- **THEN** the contract reports the invalid reference explicitly through diagnostics or invalid-reference reporting instead of silently remapping it to a surviving primitive

#### Scenario: Topology changes invalidate an ambiguous reference
- **WHEN** a topology-changing operation produces multiple plausible successors for a previously referenced primitive
- **THEN** the contract reports the invalid reference explicitly as ambiguous
- **AND** it does not silently choose one successor by traversal order, geometry heuristics, or UI ordering

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

### Requirement: Durable modeling mutations SHALL commit through DocumentRepository
The modeling contract SHALL route accepted durable document mutations through `DocumentRepository` so the authored model document is updated before a successful mutation is reported as locally durable.

#### Scenario: Accepted feature mutation is persisted
- **WHEN** a feature create, update, delete, reorder, or cursor mutation is accepted by the modeling boundary
- **THEN** the corresponding authored document change is committed through `DocumentRepository`
- **AND** the returned snapshot can be rebuilt from the repository-authored state

#### Scenario: Rejected mutation is not persisted
- **WHEN** a modeling mutation is rejected by validation, stale revision checks, or kernel capability checks
- **THEN** the authored model document stored by `DocumentRepository` remains unchanged

### Requirement: Durable snapshots SHALL be generated read models
The modeling contract SHALL expose existing document snapshot shapes as generated read models derived from the authored document and kernel rebuild state.

#### Scenario: Frontend requests current snapshot
- **WHEN** the frontend requests the current document snapshot
- **THEN** the modeling service loads the authored state through `DocumentRepository`
- **AND** returns the existing workspace snapshot shape derived from authored records, kernel rebuild results, and presentation derivation

#### Scenario: Cadara export requests raw document JSON
- **WHEN** the user exports cadara under the existing export flow
- **THEN** the exported payload preserves the existing raw durable snapshot contract unless a separate import/export change defines an authored-document-native file format

### Requirement: Modeling freshness SHALL support causal document heads
The modeling contract SHALL support repository-provided causal document heads for mutation freshness and snapshot provenance while preserving existing revision fields for current UI consumers where possible.

#### Scenario: Local mutation targets current heads
- **WHEN** a local mutation is submitted against the repository heads used to build the caller's current snapshot
- **THEN** the modeling boundary can accept the mutation if domain validation and kernel rebuild succeed

#### Scenario: Local mutation targets stale heads
- **WHEN** a local mutation is submitted after peer changes have advanced the repository heads beyond the caller's snapshot basis
- **THEN** the modeling boundary reports a stale or conflict outcome with metadata sufficient to request a refreshed snapshot

### Requirement: Peer-originated changes SHALL refresh generated snapshots
The modeling contract SHALL allow repository change notifications to drive snapshot refreshes for peer-originated authored document changes.

#### Scenario: Repository announces peer change
- **WHEN** the repository announces that the authored document changed because of a peer-originated update
- **THEN** the editor runtime requests a fresh snapshot through the modeling service
- **AND** the returned snapshot is generated from the merged authored document state

### Requirement: Modeling diagnostics SHALL distinguish merge validation failures
The modeling contract SHALL distinguish diagnostics caused by merged authored document validation from ordinary local request validation failures.

#### Scenario: Merged authored state contains invalid dependency
- **WHEN** a generated snapshot includes diagnostics caused by a peer-merged invalid feature dependency or missing durable reference
- **THEN** those diagnostics carry stable machine-readable codes that identify the issue as merge or rebuild validation rather than a local form-entry rejection

### Requirement: Durable modeling contract SHALL include Combine feature definitions
The durable modeling contract SHALL define Combine as a typed authored feature kind with versioned runtime validation, operation-history support, and snapshot hydration.

#### Scenario: Combine payload validates
- **WHEN** a modeling request submits a Combine feature definition with valid schema version, target bodies, tool bodies, and supported operation intent
- **THEN** contract validation accepts the payload as a supported authored feature definition

#### Scenario: Combine payload is malformed
- **WHEN** a modeling request submits a Combine feature definition with missing participant roles, invalid target kinds, or unsupported operation intent
- **THEN** contract validation rejects the payload with structured diagnostics instead of normalizing it through side-band selection state

#### Scenario: Combine persists through operation history
- **WHEN** a Combine feature commit succeeds
- **THEN** operation history records the Combine feature definition with its participant roles and operation intent
- **AND** replay rebuilds the same authored Combine feature order

### Requirement: Combine snapshots SHALL expose post-boolean durable body state
Generated snapshots SHALL represent the body set produced by committed Combine features and SHALL bind render exports to the resulting durable body references.

#### Scenario: Target body identity is preserved where policy allows
- **WHEN** a Combine add or subtract operation succeeds against a target body
- **THEN** the resulting snapshot preserves the target body identity where the boolean policy allows identity preservation

#### Scenario: Consumed tool body is not rendered unchanged
- **WHEN** a Combine operation consumes a tool body into the result
- **THEN** the generated snapshot and render export do not continue to expose that consumed tool body as an unchanged independent result body

#### Scenario: Downstream stale references are reported
- **WHEN** a later feature references a body, face, or edge invalidated by a committed Combine
- **THEN** rebuild reports the invalid reference through diagnostics instead of silently resolving it to unrelated topology
