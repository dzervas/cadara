## ADDED Requirements

### Requirement: Mesh import diagnostics SHALL describe discarded source and conversion result
The application error pipeline SHALL include structured mesh import diagnostics without attaching source mesh bytes or triangle payloads.

#### Scenario: Mesh conversion rejected
- **WHEN** the initial mesh import conversion fails
- **THEN** diagnostics include source format, source hash prefix, triangle counts when available, conversion phase, and rejection reason
- **AND** diagnostics do not include raw STL, raw 3MF, or triangle coordinate payloads
