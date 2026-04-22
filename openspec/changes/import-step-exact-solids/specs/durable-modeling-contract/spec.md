## ADDED Requirements

### Requirement: STEP import features SHALL produce durable exact body targets
The modeling contract SHALL expose STEP import results as durable exact body targets and subshape targets compatible with downstream feature references.

#### Scenario: Select imported face for downstream feature
- **WHEN** a restored STEP import produces a body with faces
- **THEN** the selection catalog includes durable body and face targets for that imported body
- **AND** feature definitions that accept body or face refs can reference those targets normally
