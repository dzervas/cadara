## ADDED Requirements

### Requirement: Durable feature definitions SHALL persist authored wrappers for eligible feature editor values
The modeling contract SHALL persist eligible non-reference feature editor values as authored wrappers that distinguish typed literal values from raw expression text.

#### Scenario: Literal-valued feature is committed
- **WHEN** a feature with eligible literal-valued editor fields is committed under the expression-capable feature schema
- **THEN** the durable feature definition stores those fields as literal authored values

#### Scenario: Expression-valued feature is committed
- **WHEN** a feature with eligible expression-valued editor fields is committed
- **THEN** the durable feature definition stores the raw expression text for those fields
- **AND** the durable feature definition does not store the resolved value for those fields

### Requirement: Modeling execution SHALL consume resolved feature definitions
The modeling contract SHALL provide or derive resolved concrete feature definitions before invoking solver, mock kernel, OpenCascade, or low-level geometry execution.

#### Scenario: Kernel executes an expression-authored feature
- **WHEN** a committed or preview feature contains expression-authored values
- **THEN** the modeling boundary resolves those values to concrete typed parameters before invoking kernel execution
- **AND** the kernel feature execution path receives concrete parameter types equivalent to the pre-expression contract

#### Scenario: Resolution diagnostics prevent execution
- **WHEN** an authored feature definition contains a value expression that fails resolution or value-kind validation
- **THEN** the modeling boundary returns diagnostics for that authored value
- **AND** it does not invoke kernel feature execution for that invalid definition

### Requirement: Legacy literal feature payloads SHALL normalize deliberately
The modeling contract SHALL handle pre-expression literal feature payloads only through explicit schema-versioned normalization or migration into literal authored wrappers.

#### Scenario: Legacy feature payload is loaded
- **WHEN** persistence or history replay loads a supported pre-expression feature definition
- **THEN** contract normalization converts eligible literal fields into literal authored wrappers
- **AND** unsupported malformed payloads are still rejected by runtime validation

#### Scenario: New feature payload is persisted
- **WHEN** a feature definition is persisted after this change
- **THEN** eligible non-reference feature editor values use the canonical authored wrapper shape
