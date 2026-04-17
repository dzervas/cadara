# document-variables Specification

## Purpose
TBD - created by archiving change add-document-variables-ui. Update Purpose after archive.
## Requirements
### Requirement: Document variables SHALL be persisted document records
The system SHALL represent document variables as ordered persisted document records with stable identity, user-entered name text, and user-entered value text.

#### Scenario: Snapshot exposes document variables
- **WHEN** the modeling service returns a document snapshot for a document with variables
- **THEN** the snapshot document includes the ordered variable records with each record's id, name, and value text

#### Scenario: Refresh restores document variables
- **WHEN** the application refreshes after variables were added or edited and persisted in document history
- **THEN** the restored document snapshot includes the same ordered variable records without requiring expression evaluation

### Requirement: Variable persistence MUST exclude validation results
The system MUST persist only authored variable data and MUST NOT persist runtime validation state, parsed math expression trees, dependency graphs, calculated values, or expression diagnostics on variable records.

#### Scenario: Runtime marks a variable invalid
- **WHEN** runtime UI state marks a variable value as invalid
- **THEN** persistence keeps the variable id, name, and value text unchanged and does not write an invalid flag or error message into the document variable record

#### Scenario: Expression evaluation succeeds
- **WHEN** a document variable value expression evaluates successfully
- **THEN** persistence keeps the authored value text unchanged
- **AND** the calculated expression result is not written into the document variable record

#### Scenario: Operation history records a variable expression
- **WHEN** a document variable add or update mutation is persisted in operation history
- **THEN** the operation history entry stores the authored name and raw value text
- **AND** the operation history entry does not store the calculated expression result

### Requirement: Document variable values SHALL evaluate as math expressions
The system SHALL evaluate document variable value text as math.js expressions and expose the calculated runtime result without replacing the authored value text.

#### Scenario: Simple expression evaluates
- **WHEN** a document variable named `x` has value text `50`
- **THEN** expression evaluation resolves `x` to the numeric value `50`

#### Scenario: Complex expression evaluates
- **WHEN** a document variable named `area` has value text `(10 + 5) * 2 ^ 3`
- **THEN** expression evaluation resolves `area` using math.js operator precedence and functions

#### Scenario: Dependent expression evaluates
- **WHEN** a document variable named `x` has value text `50`
- **AND** a document variable named `y` has value text `x + 50`
- **THEN** expression evaluation resolves `y` to the numeric value `100`

#### Scenario: Chained dependent expressions evaluate
- **WHEN** document variables form an acyclic dependency chain across multiple value expressions
- **THEN** expression evaluation resolves each variable from its dependencies before evaluating dependents

### Requirement: Document variable mutations SHALL validate expressions before persisting
The system SHALL validate the full candidate variable set before accepting document variable add or update mutations.

#### Scenario: Invalid variable name is rejected
- **WHEN** a document variable mutation provides an empty name or a name that is not a math-compatible identifier
- **THEN** the mutation is rejected with an error diagnostic
- **AND** the document variables remain unchanged

#### Scenario: Duplicate variable name is rejected
- **WHEN** a document variable mutation would create two document variables with the same name
- **THEN** the mutation is rejected with an error diagnostic
- **AND** the document variables remain unchanged

#### Scenario: Invalid expression syntax is rejected
- **WHEN** a document variable mutation provides value text that math.js cannot parse as a value expression
- **THEN** the mutation is rejected with an error diagnostic
- **AND** the document variables remain unchanged

#### Scenario: Unresolved variable reference is rejected
- **WHEN** a document variable value expression references a symbol that is not a document variable or supported math.js symbol
- **THEN** the mutation is rejected with an error diagnostic
- **AND** the document variables remain unchanged

#### Scenario: Cyclic variable dependency is rejected
- **WHEN** document variable value expressions depend on each other cyclically
- **THEN** the mutation is rejected with an error diagnostic
- **AND** the document variables remain unchanged

#### Scenario: Non-finite expression result is rejected
- **WHEN** a document variable value expression evaluates to a non-finite result
- **THEN** the mutation is rejected with an error diagnostic
- **AND** the document variables remain unchanged

### Requirement: Sidebar SHALL show document variables
The left sidebar SHALL show document variables in the section that previously displayed snapshot references, while preserving the underlying snapshot reference contract for non-sidebar logic.

#### Scenario: Sidebar renders variables section
- **WHEN** the workbench renders a document snapshot
- **THEN** the left sidebar shows a Variables section instead of the Snapshot References section
- **AND** the Variables section lists document variable records from the current document snapshot

#### Scenario: References remain in document data
- **WHEN** the left sidebar renders the Variables section
- **THEN** the document snapshot reference records remain available in the document data for selection, diagnostics, and future inspection logic

### Requirement: Variables section SHALL support adding variables
The Variables section header SHALL include an add button at the end of the header, and activating it SHALL append a new variable row with name and value text inputs.

#### Scenario: User adds a variable
- **WHEN** the user activates the Variables section add button
- **THEN** the system appends a new variable row to the variables list
- **AND** the new row exposes editable name and value text inputs

### Requirement: Variable values SHALL support in-place editing
The Variables section SHALL allow a user to double-click a variable row to edit that variable's value text.

#### Scenario: User double-clicks a variable
- **WHEN** the user double-clicks an existing variable row
- **THEN** the row enters value-editing mode with a value text input for that variable

#### Scenario: User commits a changed value
- **WHEN** the user changes a variable value and commits the edit
- **THEN** the persisted document variable record stores the updated raw value text without evaluating it

### Requirement: Invalid variable values SHALL be visually marked from runtime state
The Variables section SHALL render a clear danger state for any variable value marked invalid by runtime UI state, using either a red border or red background consistent with the sidebar implementation.

#### Scenario: Runtime invalid state is present
- **WHEN** runtime UI state marks a variable value as invalid
- **THEN** the variable value control or row is visually marked with danger styling

#### Scenario: Runtime invalid state is absent
- **WHEN** a variable has no runtime invalid state
- **THEN** the variable row renders without danger styling regardless of whether future expression validation might reject the value
