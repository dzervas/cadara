## MODIFIED Requirements

### Requirement: Constraint authoring SHALL support floating authored-value entry when required
The system SHALL support a generic floating input surface for constraint or dimension operations that require an authored value such as length, distance, angle, or radius.

#### Scenario: Dimensional constraint needs an authored value
- **WHEN** the user finishes selecting the required targets for a dimensional constraint
- **THEN** the editor runtime opens a floating value-entry prompt bound to the active operation and does not commit the durable mutation until the value is accepted
- **AND** the prompt preserves either a numeric literal or expression text as the pending authored value until commit or cancel

#### Scenario: Value entry is cancelled
- **WHEN** the user cancels the floating value-entry prompt for a pending constraint operation
- **THEN** the pending preview and authored-value draft are discarded without appending a durable constraint or dimension record

### Requirement: Constraint value entry SHALL appear near the active preview
The system SHALL render value-entry input for dimensional or angular constraints near the active mouse position or preview reference in the viewport.

#### Scenario: Dimension value is requested
- **WHEN** a dimensional constraint has selected its required targets and needs an authored value
- **THEN** the value input appears near the active preview reference rather than in a detached feature-editor-style panel
- **AND** the input accepts expression-capable text for supported dimension magnitudes instead of filtering input to browser numeric characters only

### Requirement: Committed dimension annotations SHALL support direct editing from the annotation chip
The system SHALL treat the committed dimension annotation chip itself as the durable edit affordance for that dimension.

#### Scenario: User double-clicks a committed dimension annotation
- **WHEN** the user double-clicks a committed dimension annotation chip
- **THEN** the editor reopens the floating value input for that durable dimension
- **AND** the reopened input is seeded from the current authored dimension source, preserving raw expression text for expression-authored dimensions and formatted numeric text for literal dimensions

#### Scenario: User commits an edit from a reopened dimension annotation
- **WHEN** the user edits the reopened committed dimension value and accepts it
- **THEN** the durable dimension record is updated with the new authored value source
- **AND** the committed dimension annotation continues to represent the same durable dimension target

## ADDED Requirements

### Requirement: Sketch dimension authoring SHALL preserve expression-capable authored values
The system SHALL allow supported driving sketch dimension magnitudes to be authored as either numeric literals or expression text that resolves against current document variables.

#### Scenario: User authors a literal dimension value
- **WHEN** the user enters a numeric literal in a sketch dimension value prompt and accepts it
- **THEN** the committed durable dimension stores that magnitude as a literal authored value
- **AND** the authored value remains eligible for the same dimension validation as the previous numeric-only field

#### Scenario: User authors an expression dimension value
- **WHEN** the user enters expression text in a sketch dimension value prompt and accepts it
- **THEN** the committed durable dimension stores the raw expression text for that magnitude
- **AND** the durable dimension does not store the expression's parsed tree or calculated result as the authored source

#### Scenario: User cancels expression dimension authoring
- **WHEN** the user enters expression text in a pending sketch dimension value prompt and cancels
- **THEN** no durable dimension record is appended or updated
- **AND** no expression text is persisted from the cancelled draft

### Requirement: Sketch dimension expressions SHALL remain limited to dimension magnitudes
Expression-capable sketch dimension values SHALL apply only to eligible driving dimension magnitude fields and MUST NOT apply to dimension references, IDs, labels, discriminants, target selections, sketch geometry coordinates, or annotation placement metadata.

#### Scenario: Dimension target references are committed
- **WHEN** a dimension with an expression-authored magnitude is accepted
- **THEN** the dimension's point, entity, line, datum, and projected-reference operands remain durable reference values
- **AND** no operand is coerced from expression text or expression result

#### Scenario: Annotation placement is committed
- **WHEN** a dimension with an expression-authored magnitude also has annotation placement metadata
- **THEN** the placement metadata remains concrete sketch-plane placement data
- **AND** the placement metadata is not represented as an authored expression value

### Requirement: Sketch dimension expression failures SHALL preserve authored dimensions
The system SHALL report expression-resolution or value-kind failures for sketch dimensions without silently rewriting, deleting, or ignoring the authored dimension.

#### Scenario: Dimension expression fails during solve or rebuild
- **WHEN** a committed sketch dimension expression cannot be parsed, references an unknown symbol, or resolves to an invalid value for that dimension kind
- **THEN** the solve or rebuild reports diagnostics for the affected dimension
- **AND** the authored dimension expression text remains unchanged in the durable sketch definition

#### Scenario: Variable change invalidates a dependent sketch dimension
- **WHEN** a document variable mutation leaves a committed sketch dimension expression unresolved or invalid
- **THEN** the variable mutation remains authored as requested
- **AND** the next sketch solve or rebuild reports diagnostics for the affected sketch dimension without replacing the expression with a stale numeric value
