## ADDED Requirements

### Requirement: Editor runtime SHALL own sequencing for covered workbench document mutations
For workbench flows covered by this change, the editor runtime SHALL own accepted mutation sequencing and follow-up refresh sequencing instead of relying on application controllers to mutate the modeling service directly and repair state afterward.

#### Scenario: Runtime-owned workbench mutation completes
- **WHEN** a covered workbench mutation such as rename, variable update, or import completion is accepted
- **THEN** the editor runtime sequences the resulting refresh or state transition
- **AND** application controllers do not finalize the flow by issuing a separate repair refresh

#### Scenario: Covered workbench mutation fails
- **WHEN** a covered workbench mutation fails or conflicts
- **THEN** the editor runtime preserves authoritative command and refresh state
- **AND** application controllers are limited to surfacing feedback instead of patching editor state directly

### Requirement: Runtime-owned refresh handoff SHALL distinguish incremental mutation from document replacement
The editor runtime SHALL expose distinct sequencing behavior for ordinary incremental mutations versus explicit whole-document replacement flows.

#### Scenario: Incremental mutation refreshes current document basis
- **WHEN** a covered incremental mutation succeeds
- **THEN** the runtime refreshes or advances the current document basis without treating the flow as full document replacement

#### Scenario: Whole-document replacement is requested
- **WHEN** the application requests replacement of the active document basis
- **THEN** the runtime processes that request through an explicit replacement handoff
- **AND** the replacement path is not reused as the generic completion path for ordinary workbench mutations
