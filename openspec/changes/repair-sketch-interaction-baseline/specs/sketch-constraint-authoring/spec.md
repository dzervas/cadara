## ADDED Requirements

### Requirement: Constraint target selection SHALL work while a constraint tool is active
The system SHALL allow active sketch constraint tools to collect valid sketch point, entity, and annotation targets from viewport selections during their target-collection phase.

#### Scenario: Hovered constraint target is selected
- **WHEN** a constraint tool shows a valid hover candidate and the user clicks that candidate
- **THEN** the active constraint authoring state records the clicked target as the next selected constraint target

#### Scenario: Invalid target click is ignored with existing feedback
- **WHEN** a constraint tool is active and the user clicks a target rejected by that tool's selection rules
- **THEN** the authoring state does not record the target and the editor preserves or reports the existing selection rejection feedback
