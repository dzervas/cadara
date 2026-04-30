## ADDED Requirements

### Requirement: Sketch special mode discovery SHALL use explicit registry composition
The system SHALL compose available sketch special editor modes explicitly and supply that composition to mode-discovery consumers instead of relying on ambient singleton mutation or cyclic import side effects.

#### Scenario: Workbench resolves supported special modes
- **WHEN** the editor needs to resolve supported sketch special editor modes
- **THEN** it reads mode availability from the explicit special-mode composition
- **AND** mode discovery does not depend on unrelated module initialization order

#### Scenario: Test supplies custom special mode
- **WHEN** a test needs to validate special-mode behavior with a custom mode definition
- **THEN** the test composes a scoped special-mode registry containing that definition
- **AND** the custom mode does not leak into other tests through long-lived global mutation

### Requirement: Special mode shared helpers SHALL preserve acyclic dependency direction
Shared identifiers, neutral schema helpers, and presentation helpers used by sketch special editor modes SHALL preserve an acyclic dependency direction between registries and mode definitions.

#### Scenario: Mode definition uses shared helper
- **WHEN** a special mode definition depends on a shared identifier or helper
- **THEN** that helper lives in a neutral module that does not require registry-owned imports back into the mode definition
- **AND** the registry can compose the mode definition without creating a runtime cycle
