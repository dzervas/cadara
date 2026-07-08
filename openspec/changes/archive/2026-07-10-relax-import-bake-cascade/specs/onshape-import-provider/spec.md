## ADDED Requirements

### Requirement: Bake cascades SHALL propagate along real dependencies only
The planner SHALL mark a feature `downstream-of-baked` only when at least one of its resolved inputs — owning sketch, profile region source, deferred body lineage, or explicit upstream reference — is baked-tier or belongs to a baked lineage; features on independent branches SHALL keep their own tier.

#### Scenario: Independent branch stays parametric
- **WHEN** a history contains a baked branch followed by a parametric sketch whose consuming extrude references only that sketch and a standalone scope
- **THEN** the sketch and extrude plan `parametric`
- **AND** carry no `downstream-of-baked` reason

#### Scenario: True dependent still bakes
- **WHEN** a feature's owning sketch, region source, or body lineage is baked
- **THEN** it plans `baked` with `downstream-of-baked`

#### Scenario: Baked branch does not distort boolean candidate counting
- **WHEN** a default-scope boolean's upstream could include a body from a baked lineage
- **THEN** the consumer remains probe-gated rather than resolving against the only visible parametric candidate
- **AND** the reason code reflects the scope ambiguity, not a region problem
