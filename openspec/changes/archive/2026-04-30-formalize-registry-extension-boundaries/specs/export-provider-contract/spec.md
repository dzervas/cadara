## ADDED Requirements

### Requirement: Export provider discovery SHALL use explicit registry composition
The export provider registry SHALL determine built-in provider availability through explicit application or bootstrap composition rather than through service-construction side effects.

#### Scenario: Modeling service is created
- **WHEN** the modeling service is constructed
- **THEN** export provider availability has already been composed explicitly or is passed in explicitly
- **AND** constructing the modeling service does not register built-in export providers as a side effect

#### Scenario: Export UI lists available formats
- **WHEN** the export UI needs to list available export formats
- **THEN** it reads provider availability from the explicit export-provider lookup surface prepared by application composition
- **AND** format availability does not depend on unrelated service initialization order

### Requirement: Export provider tests SHALL use scoped registry composition
Tests for export-provider behavior SHALL be able to compose custom provider membership without mutating long-lived process-global registry state.

#### Scenario: Test adds temporary export provider
- **WHEN** a test needs to validate export behavior with a temporary provider
- **THEN** the test composes a scoped provider lookup surface containing that provider
- **AND** the provider does not remain registered for later unrelated tests
