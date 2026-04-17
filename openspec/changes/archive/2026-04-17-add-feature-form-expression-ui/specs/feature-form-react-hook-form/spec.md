## ADDED Requirements

### Requirement: Feature-session forms SHALL provide centralized expression entry controls
Feature-session forms SHALL render expression entry controls for every non-reference field that declares authored expression support, using shared `react-hook-form` behavior rather than feature-specific or field-specific ad hoc expression UI.

#### Scenario: Expression affordance appears only for supported fields
- **WHEN** the feature inspector renders a form schema containing expression-capable numeric or enum fields and reference fields
- **THEN** every field with authored expression metadata shows an `f(x)` affordance near the control
- **AND** reference picker and reference collection fields do not show an expression affordance

#### Scenario: User opens expression edit mode
- **WHEN** the user clicks the `f(x)` affordance for an expression-capable field
- **THEN** the field's normal control is replaced by a text expression editor registered through the feature form's `react-hook-form` runtime
- **AND** a red clear expression action is rendered outside and to the right of the expression editor

#### Scenario: Expression editor live-validates with preview
- **WHEN** the user changes expression text in the expression editor
- **THEN** the form validates the expression against current document variables and the field's declared value kind
- **AND** a valid expression shows its calculated result at the end of the expression input with a dark flat preview background
- **AND** an invalid expression shows field validation feedback without replacing the authored expression text with a calculated value

#### Scenario: User accepts an expression
- **WHEN** the user blurs a valid expression editor or presses Enter inside it
- **THEN** the form exits expression edit mode
- **AND** the original field control is shown disabled and populated with the calculated display value
- **AND** the field's `f(x)` affordance uses the active foreground color
- **AND** the feature draft patch preserves the raw expression text as an authored expression value

#### Scenario: Expression-authored field reopens from session state
- **WHEN** the active feature session contains an expression-authored value for an expression-capable field
- **THEN** the feature inspector renders that field in active expression presentation without requiring the user to re-enter expression edit mode
- **AND** the disabled control shows the current calculated display value when the expression is valid

#### Scenario: User disables expression authoring for a field
- **WHEN** the user clicks the red clear expression action for a field in expression edit mode
- **THEN** the form exits expression edit mode
- **AND** the field's `f(x)` affordance returns to its normal foreground color
- **AND** the normal field control is enabled
- **AND** the feature draft patch no longer stores that field as an authored expression value
