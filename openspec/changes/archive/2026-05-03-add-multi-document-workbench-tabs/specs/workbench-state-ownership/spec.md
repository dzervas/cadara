## ADDED Requirements

### Requirement: Active document session switching SHALL use an explicit application-owned handoff
The workbench SHALL treat changing the active document tab as an application-owned document-session handoff rather than as shell-local repair logic over one long-lived singleton document session.

#### Scenario: User activates a different document tab
- **WHEN** the active tab changes to a different `documentId`
- **THEN** application-owned composition hands the workbench over to a document session for that `documentId`
- **AND** the shell does not reconcile the change by mutating document state locally and forcing an ad hoc refresh afterward

#### Scenario: Session switching preserves shell-local presentation ownership
- **WHEN** the workbench switches the active document session
- **THEN** shell-local presentation state such as sidebar width or modal visibility remains shell-owned
- **AND** the shell does not become the authoritative owner of the active document's durable state
