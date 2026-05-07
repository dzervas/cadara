## ADDED Requirements

### Requirement: Repository load results SHALL remain reusable for proven unchanged external files
When a higher-level filesystem reload proves that an authoritative external file matches the authored document returned by `DocumentRepository.load`, repository consumers SHALL be able to reuse that load result as the cache source without forcing a no-op repository mutation.

#### Scenario: Consumer reuses cached load result
- **WHEN** `DocumentRepository.load` returns a successful cached authored document result
- **AND** the document sync worker proves that the authoritative filesystem file matches that cached authored document for the active document id
- **THEN** the worker can return the original repository load result as the loaded document result
- **AND** the repository is not required to create new heads, source metadata, or change notifications for a no-op reload

#### Scenario: Reused load result preserves cache metadata
- **WHEN** a matching filesystem reload reuses a successful repository load result
- **THEN** the reused result preserves its repository heads, source, storage key, diagnostics, and asset availability
- **AND** downstream modeling freshness checks receive the same repository metadata that was associated with the cached document

#### Scenario: Changed external file still uses repository mutation
- **WHEN** the authoritative filesystem file differs from the authored document returned by `DocumentRepository.load`
- **THEN** the worker writes the file document through the repository mutation boundary
- **AND** the repository returns new mutation metadata for the changed authored state
