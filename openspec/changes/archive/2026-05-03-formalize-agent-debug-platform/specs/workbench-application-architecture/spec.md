## ADDED Requirements

### Requirement: Debug bridge bootstrap SHALL be application-owned composition work
The workbench application architecture SHALL treat dev debug namespace installation, browser-facing debug coordination, and debug-surface composition as dedicated application-layer work rather than as ad hoc shell helpers or lower-layer imports.

#### Scenario: Workbench starts in dev mode
- **WHEN** the application boots in a dev or test build
- **THEN** dedicated application-layer modules install or compose the debug bridge
- **AND** the top-level workbench shell consumes that composed bridge rather than defining the browser debug contract inline

#### Scenario: Lower layer needs debug data
- **WHEN** runtime, domain, or contract code needs to provide debug data to the platform
- **THEN** that data is passed through narrow application-facing interfaces
- **AND** lower layers do not import `src/app/` debug composition modules directly
