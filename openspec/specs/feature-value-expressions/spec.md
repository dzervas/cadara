# feature-value-expressions Specification

## Purpose
TBD - created by archiving change use-expression-values-in-feature-editor. Update Purpose after archive.
## Requirements
### Requirement: Feature editor values SHALL support authored literal and expression sources
The system SHALL represent expression-capable feature editor values with an authored value wrapper that distinguishes typed literals from raw expression text.

#### Scenario: Literal feature value is authored
- **WHEN** a feature editor value is entered as a typed literal
- **THEN** the authored feature definition stores that value as a literal source
- **AND** the value remains eligible for the same domain validation as the pre-expression typed value

#### Scenario: Expression feature value is authored
- **WHEN** a feature editor value is entered as expression text
- **THEN** the authored feature definition stores the raw expression text
- **AND** the authored feature definition does not store the parsed expression tree or calculated result

### Requirement: Feature value expressions SHALL be limited to non-reference feature editor fields
The system SHALL allow expression sources only for non-reference values surfaced by feature editor forms, and MUST reject expression sources for reference pickers, reference collections, durable references, IDs, feature discriminants, and selection targets.

#### Scenario: Numeric field accepts an expression source
- **WHEN** a feature editor numeric value such as depth, radius, angle, distance, or thickness is authored as expression text
- **THEN** the authored feature definition preserves the expression source for that value

#### Scenario: Reference field rejects an expression source
- **WHEN** a reference picker or reference collection value is provided as expression text
- **THEN** validation rejects the payload with an error diagnostic
- **AND** the reference value is not coerced from the expression result

### Requirement: Feature value expressions SHALL resolve before modeling execution
The system SHALL resolve authored feature value expressions into concrete typed feature definitions before preview, commit, rebuild, solver calls, mock kernel execution, or OpenCascade execution.

#### Scenario: Expression resolves for preview
- **WHEN** a feature preview uses an authored expression value that resolves against current document variables
- **THEN** the preview execution receives the resolved concrete typed value
- **AND** adapter and geometry code do not need to interpret the authored expression wrapper

#### Scenario: Expression fails before execution
- **WHEN** an authored expression value cannot be parsed, references an unknown symbol, or resolves to an unsupported type
- **THEN** the preview or commit request is rejected before modeling execution
- **AND** the response includes an error diagnostic for the affected feature value

### Requirement: Feature value expressions SHALL validate against value-specific result kinds
The resolver SHALL validate each expression result against the feature field's declared value kind, including finite float, positive finite float, integer, boolean, string, enum string, and angle values.

#### Scenario: Positive number expression resolves
- **WHEN** a positive-number feature value expression evaluates to a finite number greater than zero
- **THEN** the resolver returns that number as the resolved feature value

#### Scenario: Positive number expression fails domain validation
- **WHEN** a positive-number feature value expression evaluates to zero, a negative number, a non-number, or a non-finite number
- **THEN** the resolver rejects the feature value with an error diagnostic

#### Scenario: Boolean expression resolves
- **WHEN** a boolean feature value expression evaluates to a boolean
- **THEN** the resolver returns that boolean as the resolved feature value

#### Scenario: Enum expression resolves
- **WHEN** an enum feature value expression evaluates to a string that matches one of the field's declared options
- **THEN** the resolver returns that string as the resolved feature value

#### Scenario: Enum expression fails option validation
- **WHEN** an enum feature value expression evaluates to a string that is not one of the field's declared options
- **THEN** the resolver rejects the feature value with an error diagnostic

### Requirement: Feature value expression persistence MUST exclude runtime resolution state
The system MUST persist only authored feature value sources and MUST NOT persist evaluated values, parsed math.js ASTs, dependency graphs, or expression diagnostics on feature definitions or operation-history entries.

#### Scenario: Feature expression is committed
- **WHEN** a feature containing an expression-authored value is committed
- **THEN** operation history stores the raw authored expression text
- **AND** operation history does not store the calculated expression result

#### Scenario: Document refresh restores expression-authored feature
- **WHEN** a document refresh replays a committed feature containing an expression-authored value
- **THEN** the restored feature definition contains the same authored expression text
- **AND** any resolved value is recomputed from current document variables at runtime

### Requirement: Variable changes SHALL recompute dependent feature values at rebuild time
The system SHALL resolve expression-authored feature values from the current document variable evaluation whenever a feature preview, commit, or rebuild is evaluated.

#### Scenario: Variable change updates dependent feature value
- **WHEN** a document variable changes from one valid expression result to another
- **AND** a committed feature value expression references that variable
- **THEN** the next rebuild resolves the feature value from the updated variable result
- **AND** the authored feature expression text remains unchanged

#### Scenario: Variable change invalidates dependent feature value
- **WHEN** a valid document variable mutation causes a dependent committed feature expression to resolve to an invalid value for its field
- **THEN** the variable mutation remains authored as requested
- **AND** rebuild reports diagnostics for the affected feature value without rewriting the authored feature expression

### Requirement: Advanced option values SHALL preserve authored expressions
Expression-capable advanced option values SHALL preserve authored literal and expression sources through draft lifecycle, durable feature definitions, operation history, preview, commit, and rebuild.

#### Scenario: Angle option is expression-authored
- **WHEN** a user authors an advanced angle option such as draft angle or sweep twist angle as expression text
- **THEN** the feature definition preserves the raw expression text until the shared resolver produces a concrete angle for execution

#### Scenario: Integer option is expression-authored
- **WHEN** a user authors a positive integer option such as loft path section count as expression text
- **THEN** the resolver validates that the expression result is a positive integer before geometry execution

### Requirement: Advanced reference options MUST remain durable references
Advanced feature references MUST remain durable reference values through participant or reference field contracts and MUST NOT be expression-authored.

#### Scenario: Reference-like option receives expression text
- **WHEN** a feature option that selects a face, body, vertex, path, guide, or direction target receives expression text
- **THEN** validation rejects the value and does not coerce the expression result into a durable reference

