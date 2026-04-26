## MODIFIED Requirements

### Requirement: Sketch edit tools SHALL have explicit domain definitions
Sketch edit tools that mutate existing geometry SHALL have domain-level definitions for metadata, activation, activation-time selection adoption, selection requirements, validation, preview, and accepted draft mutation behavior.

#### Scenario: Runtime activates an edit tool
- **WHEN** the editor activates `trim` or `offset` while a sketch session is open
- **THEN** the runtime resolves an explicit edit-tool behavior instead of falling through to generic selection-command state

#### Scenario: Runtime seeds an edit tool from compatible current selection
- **WHEN** the editor activates a selection-driven sketch edit tool while the current sketch selection already contains targets compatible with that tool's selection rules
- **THEN** the runtime initializes the edit-tool state with those selected targets
- **AND** any staged preview or validation feedback is derived from the edit tool's existing domain logic

#### Scenario: Runtime clears incompatible current selection for an edit tool
- **WHEN** the editor activates a selection-driven sketch edit tool while the current sketch selection contains unsupported or mixed incompatible targets
- **THEN** the runtime clears the current selection
- **AND** it initializes the edit tool in an empty target-collection state
