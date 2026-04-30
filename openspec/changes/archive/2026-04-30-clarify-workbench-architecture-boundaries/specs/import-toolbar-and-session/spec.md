## ADDED Requirements

### Requirement: Generic part import activation SHALL use one shared application-owned entrypoint
The generic part-mode import flow SHALL start through one shared application-owned import entrypoint reused by toolbar and any other future trigger sources.

#### Scenario: Toolbar starts generic part import
- **WHEN** the user activates the generic part import action from the toolbar
- **THEN** the workbench invokes the shared application-owned import entrypoint
- **AND** the entrypoint owns file picking, source resolution, provider matching, and import-session startup

#### Scenario: Another trigger starts generic part import
- **WHEN** another supported trigger source requests the generic part import flow
- **THEN** the workbench invokes the same shared application-owned import entrypoint
- **AND** the import-session startup behavior matches the toolbar flow

