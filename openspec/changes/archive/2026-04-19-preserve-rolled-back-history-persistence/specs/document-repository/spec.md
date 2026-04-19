## ADDED Requirements

### Requirement: DocumentRepository SHALL round-trip rolled-back authored documents
The repository-backed document persistence path SHALL store and restore the complete authored document timeline and the active cursor, even when the active modeling snapshot is rolled back before the history tail.

#### Scenario: Refresh restores future feature after rolled-back cursor
- **WHEN** a repository-backed document contains history `sketch - extrude - sketch2 - revolve`
- **AND** the cursor is moved to `sketch2`
- **AND** the application refreshes or a fresh modeling service loads the same repository document
- **THEN** the restored authored document still contains `revolve`
- **AND** the restored cursor still references `sketch2`
- **AND** the restored document history order remains `sketch - extrude - sketch2 - revolve`

#### Scenario: Repository write after cursor move includes full timeline
- **WHEN** the modeling service persists an accepted cursor move
- **THEN** the document written through `DocumentRepository` includes all sketches, all features, complete feature order, complete history order, and the requested cursor
- **AND** persisted feature records after the cursor are not filtered to match the applied rebuild output

#### Scenario: Applied snapshot cannot overwrite future authored records
- **WHEN** the current viewport snapshot excludes future feature geometry because the cursor is rolled back
- **THEN** repository persistence still writes from complete authored inputs
- **AND** it does not replace the repository document with a document containing only the applied prefix
