## ADDED Requirements

### Requirement: Import provider discovery SHALL use explicit registry composition
The import provider registry SHALL determine available providers through explicit application or bootstrap composition instead of ambient mutable singleton registration.

#### Scenario: Import toolbar builds accept filter
- **WHEN** the generic import flow builds its browser file-picker accept filter
- **THEN** it reads accepted file types from the explicit import-provider lookup surface
- **AND** available file types do not depend on ambient singleton mutation order

#### Scenario: Import flow matches providers for a source
- **WHEN** the import flow resolves a source and matches candidate providers
- **THEN** it matches against the explicit import-provider composition supplied to the flow
- **AND** provider availability does not change as a side effect of unrelated module import order

### Requirement: Import provider tests SHALL use scoped registry composition
Tests for import-provider behavior SHALL compose temporary provider membership without mutating long-lived process-global import registry state.

#### Scenario: Test adds temporary import provider
- **WHEN** a test needs a custom import provider
- **THEN** the test composes a scoped import-provider registry or lookup surface containing that provider
- **AND** the provider does not leak into other tests through global mutation
