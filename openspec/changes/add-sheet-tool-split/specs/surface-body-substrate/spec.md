## MODIFIED Requirements

### Requirement: Solid-only features SHALL reject sheet bodies explicitly
Features and operations that require solid bodies SHALL reject sheet bodies with structured unsupported diagnostics before kernel execution. The split tool position SHALL NOT be treated as a solid-only position: a split accepts a sheet body as its tool, while its target and every other solid-only participant position still rejects sheet bodies.

#### Scenario: Sheet body is selected for fillet
- **WHEN** a fillet request targets topology owned by a sheet body
- **THEN** the adapter rejects the request with an explicit unsupported-sheet-body diagnostic
- **AND** it does not crash, skip the target, or coerce the sheet body into a solid

#### Scenario: Sheet body is selected for shell
- **WHEN** a shell request uses a sheet body as its source body
- **THEN** the adapter rejects the request with an explicit unsupported-sheet-body diagnostic
- **AND** it does not run solid shelling against sheet topology

#### Scenario: Sheet body is selected for boolean operation
- **WHEN** a boolean operation uses a sheet body as a target or tool body
- **THEN** the adapter rejects the operation with an explicit unsupported-sheet-body diagnostic
- **AND** it does not silently drop that participant from the operation

#### Scenario: Sheet body is selected for a solid-only feature
- **WHEN** a solid-only feature receives a sheet body participant
- **THEN** the adapter rejects the request with an explicit unsupported-sheet-body diagnostic before topology mutation

#### Scenario: Sheet body is selected as a split tool
- **WHEN** a split request uses a solid target body and a sheet body as its tool body
- **THEN** the adapter executes the split instead of rejecting it

#### Scenario: Sheet body is selected as a split target
- **WHEN** a split request uses a sheet body as its target body
- **THEN** the adapter rejects the request with an explicit unsupported-sheet-body diagnostic before topology mutation
