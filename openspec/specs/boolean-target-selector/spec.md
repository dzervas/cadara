# boolean-target-selector Specification

## Purpose
Define when boolean-capable feature forms expose explicit target body selectors and how those selections are preserved in feature definitions.

## Requirements
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

### Requirement: Boolean target selectors SHALL preselect likely operation intent
Boolean-capable feature authoring SHALL preselect operation intent and target body from preview geometry when the draft has no manual operation or target override and the spatial relationship to an existing body is reliable.

#### Scenario: Intersecting preview defaults to cut
- **WHEN** a boolean-capable feature preview has reliable volumetric intersection with an existing body
- **THEN** the feature draft uses the cut operation for that feature family
- **AND** the intersecting body is selected as the boolean target body

#### Scenario: Coplanar preview defaults to merge
- **WHEN** a boolean-capable feature preview has no reliable volumetric intersection and is coplanar with a face of an existing body
- **THEN** the feature draft uses the merge operation for that feature family
- **AND** the coplanar body is selected as the boolean target body

#### Scenario: No reliable body relationship defaults to new
- **WHEN** a boolean-capable feature preview has no reliable intersection or coplanar body relationship
- **THEN** the feature draft uses the standalone new-body operation for that feature family
- **AND** no boolean target body is selected

#### Scenario: Intersection takes precedence over coplanar contact
- **WHEN** a boolean-capable feature preview has both reliable volumetric intersection and coplanar contact candidates
- **THEN** the feature draft uses the cut operation for that feature family
- **AND** the intersecting body is selected as the boolean target body

#### Scenario: Manual operation selection is preserved
- **WHEN** a user manually changes the operation intent or boolean target body for a draft feature
- **AND** a later preview update would produce a different preselection result
- **THEN** the system preserves the user's manual operation and target-body choices
