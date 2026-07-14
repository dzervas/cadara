## ADDED Requirements

### Requirement: The provider SHALL prefer history-point resolutions and read both bundle versions
The bundle reader SHALL accept format versions 1 and 2; when a deterministic ID carries both final-state and history-point records, planning SHALL use the history-point signature for the consuming feature; v1 bundles SHALL plan exactly as before.

#### Scenario: History-point record preferred
- **WHEN** a v2 bundle carries final-state and history-point signatures for the same ID
- **THEN** the planner consumes the history-point record for that feature's resolution

#### Scenario: v1 bundle unchanged
- **WHEN** a v1 bundle is imported
- **THEN** planning behavior and reason codes match the pre-v2 provider exactly
