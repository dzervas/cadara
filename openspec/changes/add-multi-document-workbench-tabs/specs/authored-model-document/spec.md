## MODIFIED Requirements

### Requirement: Authored model document SHALL be the canonical persisted CAD state
The system SHALL define a versioned authored model document as the canonical persisted state for local documents, containing only user-authored and durable rebuild inputs, including the durable document name.

#### Scenario: Authored document is stored
- **WHEN** the repository persists a local document
- **THEN** the persisted authored model document includes document identity, durable document name, schema version, settings, variables, sketches, features, feature ordering, feature cursor state, and authored labels needed to rebuild the model

#### Scenario: Authored document is validated
- **WHEN** the repository loads an authored model document
- **THEN** it validates the document identity, durable document name, schema version, required authored collections, feature references, sketch references, variable records, and cursor shape before exposing it to the modeling service
