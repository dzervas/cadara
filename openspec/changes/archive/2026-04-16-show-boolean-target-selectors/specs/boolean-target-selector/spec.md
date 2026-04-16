## ADDED Requirements

### Requirement: Boolean target selectors SHALL be operation-gated
Boolean-capable feature forms SHALL show a target body selector only when the active operation is a boolean operation that requires one or more target bodies.

#### Scenario: Standalone basic operation hides target selector
- **WHEN** a basic boolean-capable feature form has `newBody` selected
- **THEN** the target body selector is hidden

#### Scenario: Basic boolean operation shows target selector
- **WHEN** a basic boolean-capable feature form has `join`, `cut`, or `intersect` selected
- **THEN** the target body selector is shown and accepts durable body targets

#### Scenario: Standalone advanced operation hides target selector
- **WHEN** an advanced boolean-capable feature form has `create` selected
- **THEN** the target body selector is hidden

#### Scenario: Advanced boolean operation shows target selector
- **WHEN** an advanced boolean-capable feature form has `add`, `subtract`, or `intersect` selected
- **THEN** the target body selector is shown and accepts durable body targets

### Requirement: Boolean target selectors SHALL preserve explicit target scope
Boolean-capable feature forms SHALL preserve selected target bodies in the feature draft and resulting feature definition whenever a boolean operation is selected.

#### Scenario: Basic boolean target body is selected
- **WHEN** a user selects one or more target bodies for a basic boolean operation
- **THEN** the resulting feature definition stores those bodies in `booleanScope`

#### Scenario: Advanced boolean target body is selected
- **WHEN** a user selects one or more target bodies for an advanced boolean operation
- **THEN** the resulting feature definition stores those bodies as `targetBody` participants

#### Scenario: Standalone operation resets explicit boolean scope
- **WHEN** a basic feature is switched back to `newBody`
- **THEN** the resulting feature definition uses `booleanScope.kind: standalone`
