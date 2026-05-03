## ADDED Requirements

### Requirement: Workbench document sessions SHALL be composed as application-owned active-session hosts
The application architecture SHALL compose the active workbench document session from application-owned bootstrap or workbench modules instead of embedding singleton document-session mutation logic directly into the top-level shell component.

#### Scenario: Workbench starts an active document session
- **WHEN** the workbench boots or restores an active tab
- **THEN** application-owned composition creates the active document-scoped modeling service and editor/runtime provider graph for that tab's `documentId`
- **AND** the top-level shell consumes that composed session rather than instantiating or retargeting singleton document-session services inline

#### Scenario: Active tab changes
- **WHEN** the user activates a different document tab
- **THEN** the workbench swaps to a newly composed active session for the selected `documentId`
- **AND** the shell remains render-focused while consuming the new active session's callbacks and view models
