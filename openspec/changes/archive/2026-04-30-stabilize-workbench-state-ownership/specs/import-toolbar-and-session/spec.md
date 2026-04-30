## ADDED Requirements

### Requirement: Generic import completion SHALL reconcile through the authoritative document-state owner
The generic part import flow SHALL route accepted commit completion, follow-up refresh, and any automatic reopen behavior through the authoritative document-state owner instead of finalizing import by manual snapshot patching in application composition code.

#### Scenario: Accepted import completes
- **WHEN** a generic part import commit succeeds
- **THEN** the workbench sequences document refresh and import-session completion through the authoritative document-state owner
- **AND** shell composition code does not manually patch snapshots to complete the flow

#### Scenario: Accepted import reopens a created sketch
- **WHEN** a generic part import commit succeeds and creates exactly one sketch that should be reopened
- **THEN** the reopen request is sequenced after the authoritative document-state update is established
- **AND** the reopen behavior does not bypass that authoritative update path
