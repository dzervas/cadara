## MODIFIED Requirements

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
