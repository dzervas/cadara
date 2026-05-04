## ADDED Requirements

### Requirement: Authored feature records SHALL persist explicit suppression state
The authored model document SHALL store an explicit `suppressed` boolean on every authored feature record. This state SHALL be durable authored replay metadata and SHALL NOT be embedded inside feature definitions or derived render state.

#### Scenario: Persist active feature
- **WHEN** an authored feature is not suppressed
- **THEN** the authored model document stores that feature record with `suppressed: false`
- **AND** the feature definition remains unchanged by the suppression field

#### Scenario: Persist suppressed feature
- **WHEN** an authored feature is suppressed
- **THEN** the authored model document stores that feature record with `suppressed: true`
- **AND** the feature remains present in feature order and document history
- **AND** derived geometry generated before suppression is not persisted as authored model document state

#### Scenario: Validate missing suppression state
- **WHEN** an authored model document feature record omits `suppressed`
- **THEN** authored document validation rejects the document as structurally invalid for the current schema
- **AND** validation does not silently infer an active or suppressed state

### Requirement: Snapshot feature records SHALL expose suppression state
The rebuilt model snapshot SHALL expose explicit suppression state for each durable feature row so application and presentation layers can distinguish active, suppressed, and rolled-back history.

#### Scenario: Snapshot includes suppressed feature row
- **WHEN** a suppressed feature is present in authored history
- **THEN** the rebuilt document snapshot includes that feature record with `suppressed: true`
- **AND** the feature record has no produced targets for geometry bypassed by suppression in that revision

#### Scenario: Snapshot includes active feature row
- **WHEN** an unsuppressed feature is present in authored history
- **THEN** the rebuilt document snapshot includes that feature record with `suppressed: false`
- **AND** produced targets reflect the current rebuild result for that feature when it is applied by the cursor
