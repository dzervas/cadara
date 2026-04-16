# feature-form-react-hook-form Specification

## Purpose
TBD - created by archiving change migrate-feature-forms-to-react-hook-form. Update Purpose after archive.
## Requirements
### Requirement: Feature-session forms SHALL use a react-hook-form runtime
The system SHALL back feature-session forms rendered by `FeatureInspector` with `react-hook-form` instead of direct per-input patch wiring, while preserving the existing feature session workflow.

#### Scenario: Numeric or enum field changes in an active feature session
- **WHEN** a user edits a numeric or enum field in an active feature-session form
- **THEN** the control is registered through the `react-hook-form` runtime and the resulting value change is translated into the existing feature draft patch flow for preview evaluation

#### Scenario: Feature commit and cancel remain editor-driven
- **WHEN** a user clicks `Commit` or `Cancel` in the feature inspector
- **THEN** the system continues to route those actions through the existing editor command workflow rather than replacing them with form-local submit or cancel semantics

### Requirement: Feature-session forms SHALL synchronize react-hook-form state with external feature-session updates
The system SHALL resynchronize the local `react-hook-form` state when the active feature session changes from outside the currently focused form control, without resetting local field state unnecessarily.

#### Scenario: Reopen or hydrate a different feature session
- **WHEN** the editor opens a different feature create or edit session
- **THEN** the feature inspector resets its `react-hook-form` state to the values derived from that newly active feature session

#### Scenario: Reference selection changes the active feature draft
- **WHEN** viewport or sidebar selection updates the active feature draft through the editor machine
- **THEN** the feature inspector reflects the resulting session values into `react-hook-form` without leaving stale field values visible

### Requirement: Feature reference picking SHALL remain machine-driven while updating react-hook-form state
The system MUST preserve the existing editor-machine ownership of active reference picker state, selection filters, and durable reference application while bridging the resulting selected values into the feature form runtime.

#### Scenario: User activates a feature reference picker
- **WHEN** the user activates a single-reference or multi-reference field in the feature inspector
- **THEN** the system continues to use the editor-machine reference-picker flow and active picker field tracking for subsequent durable selections

#### Scenario: User selects a durable target for the active feature picker
- **WHEN** the editor machine accepts a viewport or sidebar target for the active feature reference field
- **THEN** the selected durable reference is applied through the existing feature patch semantics and the feature inspector updates the corresponding `react-hook-form` field value

### Requirement: Feature-domain coercion and validation SHALL remain outside presentational React form code
The system MUST preserve feature-authoring ownership of domain-specific value coercion and validation semantics during the migration to `react-hook-form`.

#### Scenario: Angle field displays degrees but patches radians
- **WHEN** a user edits a feature angle field displayed in degrees
- **THEN** the feature form runtime preserves the existing patch semantics that convert the displayed degree value into the draft's radian value before preview and commit

#### Scenario: Feature field validity is derived from feature authoring rules
- **WHEN** a feature field is invalid because of feature-specific draft rules or missing references
- **THEN** the invalid state presented in the feature inspector remains derived from the feature-authoring/schema layer rather than from React component-local modeling logic

### Requirement: Sketch authoring forms SHALL remain out of scope for this migration
The system MUST NOT apply the feature-form `react-hook-form` migration to sketch-only authoring controls.

#### Scenario: Sketch tool panel remains on its existing form path
- **WHEN** a user edits sketch tool controls or sketch floating inputs
- **THEN** those sketch-only controls continue to use their existing sketch authoring implementation and are not migrated as part of the feature-form runtime change

