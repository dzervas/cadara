## ADDED Requirements

### Requirement: Operation history replay SHALL preserve safe partial results for repairable feature failures
Compatibility operation-history replay SHALL render every safely replayable result from a structurally valid history when feature replay fails for repairable feature errors, while preserving the full authored history for repair.

#### Scenario: Replay reports failed feature
- **WHEN** operation-history replay encounters a structurally valid feature entry whose authored reference or parameter cannot rebuild
- **THEN** replay reports a feature-scoped diagnostic for the failed entry
- **AND** it does not silently drop, coerce, or skip the failed feature

#### Scenario: Replay discovers independent later failures
- **WHEN** operation-history replay contains multiple repairable broken feature entries that can be evaluated independently
- **THEN** replay reports each independently discoverable feature error in one restore
- **AND** diagnostics are not limited to the first failed entry

#### Scenario: Later authored entries remain recoverable
- **WHEN** a replayed history contains additional entries after the failed feature
- **THEN** those entries remain represented in authored history after restore
- **AND** dependent later entries are not applied to the rendered result until the blocking feature error is repaired
- **AND** independent later entries may be rendered when they can be safely replayed without failed outputs

#### Scenario: Structurally invalid history still fails explicitly
- **WHEN** operation-history data is malformed, uses an unsupported schema version, or contains an unsupported operation entry
- **THEN** replay fails explicitly with invalid-history diagnostics
- **AND** the valid-prefix behavior for repairable feature rebuild failures does not mask structural history errors
