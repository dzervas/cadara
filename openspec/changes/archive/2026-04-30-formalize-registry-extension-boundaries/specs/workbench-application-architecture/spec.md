## ADDED Requirements

### Requirement: Extension registry composition SHALL be application-owned bootstrap work
The application architecture SHALL treat provider and mode registry composition as an application or bootstrap concern rather than a responsibility of shell components or unrelated domain service constructors.

#### Scenario: Application starts built-in extension surfaces
- **WHEN** the application prepares workbench services and UI surfaces
- **THEN** it composes the built-in extension registries explicitly during bootstrap
- **AND** no shell component is responsible for registering providers or modes during render

#### Scenario: Domain service consumes extension lookup
- **WHEN** a domain service needs extension lookup capability
- **THEN** the application wiring passes that capability into the service explicitly
- **AND** the service does not take ownership of built-in extension registration
