## ADDED Requirements

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
