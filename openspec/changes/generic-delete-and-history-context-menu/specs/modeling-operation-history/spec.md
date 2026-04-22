## ADDED Requirements

### Requirement: Operation history SHALL record generic document deletion mutations
The system SHALL record each accepted generic document deletion mutation as one typed operation-history entry carrying the accepted deletion target, and SHALL exclude rejected or conflicted deletion requests.

#### Scenario: Persist accepted feature history deletion
- **WHEN** a committed feature history item is deleted through the generic deletion mutation
- **THEN** persisted operation history appends one generic deletion entry containing that feature history item target

#### Scenario: Persist accepted sketch history deletion
- **WHEN** a committed sketch history item is deleted through the generic deletion mutation
- **THEN** persisted operation history appends one generic deletion entry containing that sketch history item target

#### Scenario: Persist accepted body deletion
- **WHEN** a supported body or part row is deleted through the generic deletion mutation
- **THEN** persisted operation history appends one generic deletion entry containing the accepted durable deletion target

#### Scenario: Rejected deletion is not persisted
- **WHEN** a generic deletion mutation is rejected or conflicts
- **THEN** persisted operation history does not append a deletion entry for that request

### Requirement: Operation history replay SHALL apply generic document deletion mutations
Operation-history replay SHALL apply generic deletion entries in recorded order through the modeling boundary so restored authored documents match the accepted deletion sequence from the original session.

#### Scenario: Replay generic deletion sequence
- **WHEN** a persisted operation history contains committed sketches, committed features, and later generic deletion entries
- **THEN** refresh replay applies those deletion entries in their recorded order
- **AND** the rebuilt document history and Parts & Objects tree match the accepted state from the original session

#### Scenario: Replay invalid generic deletion entry
- **WHEN** replay encounters a generic deletion entry whose target does not resolve or is unsupported
- **THEN** restore fails explicitly with diagnostics
- **AND** the system does not silently drop, coerce, or partially apply the invalid deletion entry

#### Scenario: Replay legacy feature deletion entry
- **WHEN** operation-history replay reads an existing feature-only delete entry
- **THEN** it continues to replay that entry as a feature deletion
- **AND** valid existing histories do not require manual migration
