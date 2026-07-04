## MODIFIED Requirements

### Requirement: Feature value expressions SHALL resolve before modeling execution
The system SHALL resolve authored feature value expressions and other supported authored modeling value expressions into concrete typed values before preview, commit, rebuild, solver calls, mock kernel execution, or OpenCascade execution.

#### Scenario: Expression resolves for preview
- **WHEN** a feature preview uses an authored expression value that resolves against current document variables
- **THEN** the preview execution receives the resolved concrete typed value
- **AND** adapter and geometry code do not need to interpret the authored expression wrapper

#### Scenario: Sketch dimension expression resolves for solve
- **WHEN** a sketch solve or rebuild uses a dimension magnitude authored as expression text that resolves against current document variables
- **THEN** the sketch solver receives a concrete numeric dimension value
- **AND** solver code does not need to interpret the authored expression wrapper

#### Scenario: Expression fails before execution
- **WHEN** an authored expression value cannot be parsed, references an unknown symbol, or resolves to an unsupported type
- **THEN** the preview, commit, rebuild, or solve request reports diagnostics before the affected execution boundary consumes the value
- **AND** the response includes an error diagnostic for the affected authored value

### Requirement: Feature value expression persistence MUST exclude runtime resolution state
The system MUST persist only authored value sources for expression-capable modeling values and MUST NOT persist evaluated values, parsed math.js ASTs, dependency graphs, or expression diagnostics on durable feature definitions, sketch dimension definitions, or operation-history entries.

#### Scenario: Feature expression is committed
- **WHEN** a feature containing an expression-authored value is committed
- **THEN** operation history stores the raw authored expression text
- **AND** operation history does not store the calculated expression result

#### Scenario: Sketch dimension expression is committed
- **WHEN** a sketch dimension containing an expression-authored magnitude is committed
- **THEN** operation history stores the raw authored expression text for that magnitude
- **AND** operation history does not store the calculated expression result for that magnitude

#### Scenario: Document refresh restores expression-authored feature
- **WHEN** a document refresh replays a committed feature containing an expression-authored value
- **THEN** the restored feature definition contains the same authored expression text
- **AND** any resolved value is recomputed from current document variables at runtime

#### Scenario: Document refresh restores expression-authored sketch dimension
- **WHEN** a document refresh replays a committed sketch containing an expression-authored dimension magnitude
- **THEN** the restored sketch definition contains the same authored expression text
- **AND** any resolved dimension value is recomputed from current document variables at runtime

### Requirement: Variable changes SHALL recompute dependent feature values at rebuild time
The system SHALL resolve expression-authored modeling values from the current document variable evaluation whenever a dependent feature or sketch preview, commit, solve, or rebuild is evaluated.

#### Scenario: Variable change updates dependent feature value
- **WHEN** a document variable changes from one valid expression result to another
- **AND** a committed feature value expression references that variable
- **THEN** the next rebuild resolves the feature value from the updated variable result
- **AND** the authored feature expression text remains unchanged

#### Scenario: Variable change updates dependent sketch dimension value
- **WHEN** a document variable changes from one valid expression result to another
- **AND** a committed sketch dimension expression references that variable
- **THEN** the next sketch solve or rebuild resolves the dimension value from the updated variable result
- **AND** the authored dimension expression text remains unchanged

#### Scenario: Variable change invalidates dependent feature value
- **WHEN** a valid document variable mutation causes a dependent committed feature expression to resolve to an invalid value for its field
- **THEN** the variable mutation remains authored as requested
- **AND** rebuild reports diagnostics for the affected feature value without rewriting the authored feature expression

#### Scenario: Variable change invalidates dependent sketch dimension value
- **WHEN** a valid document variable mutation causes a dependent committed sketch dimension expression to resolve to an invalid value for its dimension kind
- **THEN** the variable mutation remains authored as requested
- **AND** solve or rebuild reports diagnostics for the affected sketch dimension without rewriting the authored dimension expression
