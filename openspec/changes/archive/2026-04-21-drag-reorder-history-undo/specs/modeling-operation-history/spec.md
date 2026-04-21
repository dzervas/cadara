## ADDED Requirements

### Requirement: Operation history SHALL record document history reorder mutations
The system SHALL record each accepted document history reorder mutation as one typed operation entry that can move either a committed sketch or committed feature within the shared authored history order.

#### Scenario: Persist accepted sketch reorder
- **WHEN** a committed sketch is reordered in document history and the modeling mutation is accepted
- **THEN** persisted operation history appends one document history reorder entry containing the moved sketch identity and accepted insertion anchor

#### Scenario: Persist accepted feature reorder
- **WHEN** a committed feature is reordered in document history and the modeling mutation is accepted
- **THEN** persisted operation history appends one document history reorder entry containing the moved feature identity and accepted insertion anchor

#### Scenario: Rejected reorder is not persisted
- **WHEN** a document history reorder mutation is rejected or conflicts
- **THEN** persisted operation history does not append a document history reorder entry for that mutation

### Requirement: Operation history replay SHALL preserve mixed document order mutations
Operation history replay SHALL apply persisted document history reorder entries in sequence so rebuilt authored documents preserve accepted sketch and feature order changes.

#### Scenario: Replay sketch and feature reorder sequence
- **WHEN** a persisted operation history contains committed sketches, committed features, and later document history reorder entries
- **THEN** refresh replay applies those reorder entries in their recorded order
- **AND** the rebuilt document history matches the accepted authored order from the original session

#### Scenario: Replay invalid reorder entry
- **WHEN** replay encounters a document history reorder entry that references a missing moved item or missing insertion anchor
- **THEN** restore fails explicitly with diagnostics
- **AND** the system does not silently drop, coerce, or partially apply the invalid reorder entry

#### Scenario: Replay legacy feature reorder entry
- **WHEN** operation history replay reads an existing feature-only reorder entry
- **THEN** it continues to replay that entry as a feature reorder
- **AND** valid existing histories do not require manual migration
