## ADDED Requirements

### Requirement: Advanced option values SHALL preserve authored expressions
Expression-capable advanced option values SHALL preserve authored literal and expression sources through draft lifecycle, durable feature definitions, operation history, preview, commit, and rebuild.

#### Scenario: Angle option is expression-authored
- **WHEN** a user authors an advanced angle option such as draft angle or sweep twist angle as expression text
- **THEN** the feature definition preserves the raw expression text until the shared resolver produces a concrete angle for execution

#### Scenario: Integer option is expression-authored
- **WHEN** a user authors a positive integer option such as loft path section count as expression text
- **THEN** the resolver validates that the expression result is a positive integer before geometry execution

### Requirement: Advanced reference options MUST remain durable references
Advanced feature references MUST remain durable reference values through participant or reference field contracts and MUST NOT be expression-authored.

#### Scenario: Reference-like option receives expression text
- **WHEN** a feature option that selects a face, body, vertex, path, guide, or direction target receives expression text
- **THEN** validation rejects the value and does not coerce the expression result into a durable reference
