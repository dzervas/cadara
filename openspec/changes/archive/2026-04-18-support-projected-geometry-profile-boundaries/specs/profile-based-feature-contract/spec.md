## ADDED Requirements

### Requirement: Profile-based features SHALL preserve projected-boundary invalidation semantics
Profile-based feature rebuilds SHALL preserve live-derived projected profile references and report invalidation explicitly when referenced projected boundaries cannot be resolved.

#### Scenario: Feature rebuilds projected-boundary profile
- **WHEN** a profile-based feature references a sketch region containing projected boundary segments
- **THEN** feature replay rebuilds the profile from live-derived projected geometry for the active revision

#### Scenario: Projected-boundary profile is invalidated
- **WHEN** one or more projected boundary segments cannot be resolved during feature replay
- **THEN** the feature reports explicit invalidation diagnostics instead of silently changing the profile or using copied geometry
