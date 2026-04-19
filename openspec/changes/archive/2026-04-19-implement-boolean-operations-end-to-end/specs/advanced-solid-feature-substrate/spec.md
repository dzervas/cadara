## ADDED Requirements

### Requirement: Advanced substrate SHALL include Combine as a body operation feature
The advanced solid feature substrate SHALL include Combine as a concrete body operation feature with explicit target-body and tool-body participant roles.

#### Scenario: Combine declares participant roles
- **WHEN** Combine is registered as an advanced solid feature
- **THEN** its authoring descriptor declares target-body and tool-body participants with durable body target kinds

#### Scenario: Combine declares supported boolean intents
- **WHEN** the editor or modeling boundary inspects Combine operation support
- **THEN** Combine declares `add`, `subtract`, and `intersect` as supported operation intents
- **AND** each operation requires both target-body and tool-body participants

#### Scenario: Combine rejects unsupported operation intent
- **WHEN** a Combine definition contains an operation intent outside `add`, `subtract`, or `intersect`
- **THEN** advanced feature validation returns an unsupported-operation diagnostic

