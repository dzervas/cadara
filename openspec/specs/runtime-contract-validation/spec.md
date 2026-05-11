# runtime-contract-validation Specification

## Purpose
TBD - created by archiving change introduce-zod-contract-validation. Update Purpose after archive.
## Requirements
### Requirement: Externally sourced and persisted contract payloads SHALL be validated by shared runtime schemas
The system SHALL validate externally sourced and persisted payloads through shared Typia-generated runtime validators derived from canonical TypeScript contract types, rather than through duplicated handwritten record and field checks or separately maintained Zod schemas spread across multiple modules.

#### Scenario: Frontend reads a modeling snapshot payload
- **WHEN** the frontend modeling boundary receives a document snapshot or render-export payload
- **THEN** it validates that payload through the shared generated runtime validator for that contract family before exposing typed data to the rest of the application

#### Scenario: Application loads persisted operation history
- **WHEN** the application reads a serialized operation-history payload from persistence
- **THEN** it validates that payload through the shared generated runtime validator for operation history before attempting replay

#### Scenario: Payload contains superfluous persisted fields
- **WHEN** an external or persisted contract payload contains fields that are not part of the canonical TypeScript contract type
- **THEN** strict boundary validation rejects the payload instead of silently accepting the extra fields

### Requirement: Contract-boundary validation failures SHALL expose actionable messages
The system SHALL surface explicit validation messages for high-signal boundary failures from generated validators and post-validation invariant checks, including version mismatches, malformed persisted payloads, missing required top-level sections, invalid non-empty collections, invalid positive numeric fields, and contract-specific invariant failures where required by the contract.

#### Scenario: Payload uses an unsupported version
- **WHEN** a request, response, snapshot, or persisted history payload declares an unsupported contract or schema version
- **THEN** the validation failure explicitly identifies the mismatched version field and the expected version

#### Scenario: Persisted history payload is malformed
- **WHEN** persistence loading encounters malformed or structurally invalid operation-history data
- **THEN** the system surfaces an actionable validation message instead of a generic unknown parse failure

#### Scenario: Post-validation invariant fails
- **WHEN** a payload passes generated structural validation but fails a required contract-specific invariant
- **THEN** the system reports the named invariant failure at the exported contract boundary before domain replay or rendering begins

### Requirement: Internal domain invariants SHALL be allowed to remain code-level assertions
The system SHALL allow internal geometry, topology, and workflow invariants to remain as code-level assertions when runtime schemas would not reduce code or improve clarity.

#### Scenario: Geometry invariant is violated after payload parsing
- **WHEN** a payload has already passed contract-boundary schema validation but later violates an internal geometry or topology invariant
- **THEN** the implementation may report that failure through code-level assertions rather than forcing the invariant into the shared runtime schema layer

### Requirement: Runtime schemas SHALL validate authored value wrappers
Shared generated runtime validators SHALL validate authored value wrappers at contract and persistence boundaries, including the source discriminant, literal value shape, expression text shape, and whether the field permits expression sources.

#### Scenario: Valid expression wrapper is parsed
- **WHEN** a payload contains an expression-authored value for a field that permits expressions
- **THEN** runtime validation accepts the wrapper shape before runtime expression resolution occurs

#### Scenario: Expression wrapper is used on an unsupported field
- **WHEN** a payload contains an expression-authored value for a reference field, discriminant field, ID field, or other unsupported field
- **THEN** runtime validation rejects the payload with an actionable validation message

### Requirement: Runtime schemas SHALL report actionable authored-value validation failures
Runtime validation failures for authored values SHALL identify whether the failure came from wrapper shape, unsupported expression use, literal type mismatch, missing expression text, unsupported schema version, or a post-validation invariant attached to the authored value contract.

#### Scenario: Literal wrapper has the wrong type
- **WHEN** a positive numeric authored value contains a literal string instead of a number
- **THEN** runtime validation reports that the literal value has the wrong type for that field

#### Scenario: Expression wrapper lacks expression text
- **WHEN** an expression-authored value omits usable expression text
- **THEN** runtime validation reports that expression text is required for that field

### Requirement: Runtime validation SHALL be generated from canonical TypeScript contract types
The system SHALL generate runtime contract validators from the canonical TypeScript contract types rather than from a separately maintained schema DSL.

#### Scenario: Boundary validator is authored
- **WHEN** a contract family needs runtime validation for an external or persisted payload
- **THEN** the validator is derived from the TypeScript contract type through Typia
- **AND** the implementation does not duplicate the same object shape in a handwritten runtime schema DSL

#### Scenario: Primitive contract constraint is required
- **WHEN** a field's primitive constraint is part of the serialized contract shape
- **THEN** the constraint is represented in the owning TypeScript contract type or a named contract helper type that Typia can validate
- **AND** the generated validator enforces that constraint before the payload is exposed as typed data

### Requirement: Typia transforms SHALL run anywhere runtime validators execute
The repository SHALL configure Typia transformation for every supported development, build, and test path that can execute generated validators.

#### Scenario: Browser bundle executes validation
- **WHEN** the Vite development server, production build, or single-file build executes a generated runtime validator
- **THEN** the validator has been transformed into executable validation code before runtime
- **AND** the application does not reach an untransformed Typia placeholder failure

#### Scenario: Bun test executes validation
- **WHEN** a Bun-managed logic, UI, static, or umbrella test command executes a generated runtime validator
- **THEN** the validator has been transformed into executable validation code before runtime
- **AND** the test harness fails clearly if Typia transformation is missing

### Requirement: Zod validation surfaces SHALL be absent
The repository SHALL not retain Zod as a dependency, import, type source, parser API, error adapter, compatibility facade, or deprecated validation implementation after the migration.

#### Scenario: Contributor searches runtime validation code
- **WHEN** a contributor scans source, tests, package metadata, and lockfiles after the migration
- **THEN** no Zod package dependency, Zod import, `ZodError`, `ZodIssue`, `z.infer`, `.safeParse`, `.parse` wrapper, or Zod-shaped validation facade remains

#### Scenario: Static policy checks run
- **WHEN** the repository static lane runs
- **THEN** it fails if Zod is reintroduced or if a deprecated validation compatibility API is added around Typia

