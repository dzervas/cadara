## ADDED Requirements

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

