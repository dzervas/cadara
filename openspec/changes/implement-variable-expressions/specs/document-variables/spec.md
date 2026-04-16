## ADDED Requirements

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

## MODIFIED Requirements

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
