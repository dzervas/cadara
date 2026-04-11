## MODIFIED Requirements

### Requirement: Invalid or unsupported history fails explicitly
The system MUST reject persisted histories that do not match the declared schema version or that contain invalid operation entries, and it MUST surface explicit diagnostics instead of silently producing an assumed partial restore.

#### Scenario: Stored history uses an unsupported schema version
- **WHEN** startup reads a persisted operation-history payload whose schema version is not supported by the current application build
- **THEN** restore fails explicitly with an invalid-history condition and the system does not silently replay or coerce the payload

#### Scenario: Stored history contains an unreplayable operation entry
- **WHEN** kernel replay rejects a persisted operation entry because its payload is invalid or unsupported
- **THEN** the system reports replay failure explicitly and does not present the resulting document state as a successful restore

#### Scenario: Stored history is malformed before replay
- **WHEN** startup reads persisted operation-history data that is valid JSON but structurally invalid for the operation-history contract
- **THEN** schema validation fails before replay begins and surfaces an actionable invalid-history message

#### Scenario: Stored history omits a required non-empty contract field
- **WHEN** startup reads persisted operation-history data whose operation payload violates a required non-empty or positive-value contract rule
- **THEN** schema validation rejects the payload explicitly rather than allowing replay to fail later through incidental runtime errors
