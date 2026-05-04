## ADDED Requirements

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
