# advanced-feature-option-contract Specification

## Purpose
TBD - created by archiving change extend-feature-option-substrate. Update Purpose after archive.
## Requirements
### Requirement: Advanced options SHALL be described by typed descriptors
The system SHALL define shared advanced feature option descriptors for boolean, enum, angle, positive number, positive integer, nested group, and discriminated union option values.

#### Scenario: Feature declares advanced options
- **WHEN** a feature authoring definition exposes advanced feature options
- **THEN** each option declares a stable key, label, value kind, required state, default behavior, and patch target without relying on ad hoc `Record<string, unknown>` interpretation

#### Scenario: Discriminated option group is declared
- **WHEN** an option group has mutually exclusive variants such as sweep twist type or extent mode
- **THEN** the descriptor identifies the active discriminant and the fields owned by each variant

### Requirement: Advanced option validation SHALL use shared value-kind rules
The system SHALL validate advanced option values through shared value-kind and discriminated-group rules before preview, commit, rebuild, or operation-history replay reaches geometry execution.

#### Scenario: Positive integer option is invalid
- **WHEN** an advanced option such as loft path section count resolves to a non-integer, zero, negative, or non-finite value
- **THEN** validation rejects the feature with an option-specific diagnostic before geometry execution

#### Scenario: Inactive discriminated values are present
- **WHEN** a submitted advanced option group contains values for inactive variants
- **THEN** durable feature validation rejects the inactive variant values before geometry execution
- **AND** UI draft state MAY remember inactive values only if they are omitted from the built durable feature definition

### Requirement: Advanced option contracts SHALL preserve feature-specific typing
Shared advanced option descriptors SHALL be reusable by typed feature contracts and advanced-solid feature contracts without requiring every feature to use the same serialized parameter shape.

#### Scenario: Typed feature uses shared option primitive
- **WHEN** extrude or revolve uses a shared extent or angle option primitive
- **THEN** its durable feature definition remains a typed feature-specific contract while reusing the shared primitive semantics

#### Scenario: Advanced-solid feature uses shared option primitive
- **WHEN** sweep or loft uses a shared enum, angle, integer, or discriminated option descriptor
- **THEN** its durable advanced-solid options preserve the same validated option semantics

