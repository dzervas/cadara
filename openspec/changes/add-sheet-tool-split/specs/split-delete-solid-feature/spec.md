## MODIFIED Requirements

### Requirement: Split SHALL use explicit body and split-tool participants
The split feature SHALL define its inputs through explicit advanced-solid participants rather than inferred body context or hidden split-tool rules. The `targetBody` participant SHALL name a solid body, and the `toolBody` participant SHALL accept either a solid body or a sheet body.

#### Scenario: Split declares required participants
- **WHEN** the split authoring definition is registered
- **THEN** it declares at least one required `targetBody` participant and one required supported split-tool participant such as `plane` or `toolBody`

#### Scenario: Split accepts a selected participant
- **WHEN** the user selects an accepted durable target for the active split participant role
- **THEN** the split draft records that target under the correct role without overwriting unrelated participant roles

#### Scenario: Split rejects an invalid participant
- **WHEN** the user selects a durable target that does not match the active split participant role
- **THEN** the editor reports a role-specific invalid-target diagnostic rather than coercing that target into another role

#### Scenario: Split tool participant copy does not exclude sheet bodies
- **WHEN** the split authoring definition presents its tool participant
- **THEN** its copy describes the tool as a solid or sheet body rather than claiming the tool must be a solid body

### Requirement: Split and delete-solid SHALL handle kernel support explicitly
Split and delete-solid SHALL either build supported geometry changes through the modeling adapter or return structured unsupported-case diagnostics for valid but unsupported definitions. A split whose tool body is a sheet body SHALL be built as a splitter operation that subdivides the solid target, and SHALL NOT be built as a solid-boolean remainder plus tool-side pair.

#### Scenario: Supported split is previewed
- **WHEN** the modeling adapter receives a supported split definition with valid target-body and split-tool participants
- **THEN** preview returns transient render geometry and diagnostics consistent with the current preview contract without mutating committed document state

#### Scenario: Supported delete-solid is committed
- **WHEN** the modeling adapter receives a supported delete-solid definition in a commit request
- **THEN** the committed document removes the targeted body or bodies and updates document views consistently

#### Scenario: Unsupported split or delete-solid combination is requested
- **WHEN** the modeling adapter receives a contract-valid split or delete-solid definition that the current kernel implementation cannot build or apply
- **THEN** the response includes a structured unsupported-case diagnostic rather than dropping participants, deleting extra bodies, or guessing alternate geometry

#### Scenario: Solid target is split by a sheet tool
- **WHEN** the modeling adapter receives a split whose target body is a solid and whose tool body is a sheet body that crosses the target
- **THEN** the kernel subdivides the target with a splitter operation and tracks each resulting solid as a result body

#### Scenario: Sheet tool is consumed or kept
- **WHEN** a sheet-tool split is executed
- **THEN** the sheet tool body is kept in the resulting bodies unless the split's `keepTools` option is `false`, in which case it is removed, exactly as for a solid tool body

#### Scenario: Sheet body is used as the split target
- **WHEN** the modeling adapter receives a split whose target body is a sheet body
- **THEN** the request is rejected with the explicit unsupported-sheet-body diagnostic for split

#### Scenario: Split invalidates target topology references
- **WHEN** a sheet-tool split subdivides its target body
- **THEN** the surviving target topology references are invalidated as ambiguous and the vanished ones as deleted, through the same history path the solid-tool split uses
