## MODIFIED Requirements

### Requirement: Authored model document SHALL exclude derived runtime and presentation state
The authored model document MUST NOT persist derived render exports, feature tree rows, object tree rows, selection catalogs, preview state, diagnostics, OpenCascade runtime objects, transient editor state, repository-local durable undo metadata, or local draft-history bookkeeping.

#### Scenario: Snapshot is rebuilt from authored state
- **WHEN** the modeling service exposes a current document snapshot
- **THEN** it derives the kernel snapshot, presentation rows, diagnostics, and render export from the authored model document and rebuild runtime
- **AND** those derived values are not read as persisted Automerge document fields

#### Scenario: Preview is evaluated
- **WHEN** a feature preview is evaluated
- **THEN** preview geometry and preview diagnostics remain transient
- **AND** they are not written into the authored model document

#### Scenario: Local durable history is restored
- **WHEN** the local editing context restores repository-backed durable undo metadata or draft-history bookkeeping
- **THEN** that metadata is restored through repository-local persistence behavior
- **AND** it is not treated as authored model document content
