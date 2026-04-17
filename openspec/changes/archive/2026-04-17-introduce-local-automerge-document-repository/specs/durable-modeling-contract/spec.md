## ADDED Requirements

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
