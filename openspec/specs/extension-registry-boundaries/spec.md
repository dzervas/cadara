# extension-registry-boundaries Specification

## Purpose
TBD - created by archiving change formalize-registry-extension-boundaries. Update Purpose after archive.
## Requirements
### Requirement: Runtime extension membership SHALL be composed explicitly
The application SHALL compose runtime extension membership explicitly for provider and mode registries instead of relying on import-time registration side effects or ambient mutable singleton mutation.

#### Scenario: Built-in extensions are composed at startup
- **WHEN** the application initializes its runtime extension surfaces
- **THEN** built-in export providers, import providers, and sketch special modes are assembled through an explicit composition step
- **AND** extension availability does not depend on constructing an unrelated service first

#### Scenario: Consumer receives composed registry
- **WHEN** a domain service or UI surface needs extension lookup
- **THEN** it receives an explicit registry or lookup surface from application composition
- **AND** it does not discover extensions by mutating or reading an ambient process-global singleton directly

### Requirement: Runtime extension registries SHALL not require cyclic dependency direction
The system SHALL structure extension registries, definitions, and neutral helpers so registry discovery does not require runtime import cycles.

#### Scenario: Special mode is resolved
- **WHEN** the runtime resolves a sketch special mode definition
- **THEN** the registry, definition, and any shared helpers follow an acyclic dependency direction
- **AND** mode discovery does not depend on a registry importing a definition that imports registry-coupled presentation helpers

### Requirement: Tests SHALL compose scoped extension registries
Tests SHALL be able to create temporary extension compositions without mutating long-lived global runtime registry state shared across unrelated tests.

#### Scenario: Test injects custom provider
- **WHEN** a test needs a custom import or export provider
- **THEN** the test composes a scoped registry or lookup surface containing that provider
- **AND** provider availability outside that test remains unchanged

#### Scenario: Test injects custom special mode
- **WHEN** a test needs a custom sketch special mode definition
- **THEN** the test composes a scoped special-mode registry
- **AND** that definition does not leak into unrelated tests through global mutation

