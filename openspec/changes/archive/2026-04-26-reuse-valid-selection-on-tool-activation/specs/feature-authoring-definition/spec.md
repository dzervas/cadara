## MODIFIED Requirements

### Requirement: Feature authoring definitions SHALL own selection semantics
Each feature authoring definition SHALL declare its selection filter and SHALL define how accepted selections are applied to the feature draft, including activation-time reuse of the current selection.

#### Scenario: Runtime asks a feature which targets are selectable
- **WHEN** a feature command becomes active
- **THEN** the editor resolves the selection filter from the feature authoring definition for that feature

#### Scenario: Runtime applies a selected durable target
- **WHEN** the user selects a durable target while a feature command is active
- **THEN** the active feature authoring definition interprets that target into draft changes according to feature-specific rules

#### Scenario: Runtime seeds a feature draft from current selection
- **WHEN** a feature command becomes active while the current durable selection is compatible with that feature's selection filter
- **THEN** the editor replays those selected targets through the active feature authoring definition in selection order
- **AND** the resulting draft changes use the same feature-specific selection semantics as later interactive picks

#### Scenario: Runtime clears incompatible current selection for a feature
- **WHEN** a feature command becomes active while the current selection does not satisfy that feature's selection filter
- **THEN** the editor clears the current selection
- **AND** it does not partially apply the incompatible selection to the new feature draft
