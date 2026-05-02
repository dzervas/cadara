## MODIFIED Requirements

### Requirement: Dev-only structured state bridge SHALL expose editor state on window
The system SHALL expose a dev-only browser debug namespace on `window` for Playwright tests and coding agents. That namespace SHALL include structured state equivalent to the workbench debugger model, supported debug actions, and access to bounded trace data rather than limiting the bridge to a single state snapshot object.

#### Scenario: Test reads machine state from bridge
- **WHEN** a Playwright test calls the documented state accessor on the dev debug namespace
- **THEN** the returned value matches the current editor state machine state label

#### Scenario: Test reads selection targets from bridge
- **WHEN** a Playwright test calls the documented state accessor on the dev debug namespace for selection targets
- **THEN** the returned value contains the same target identifiers currently represented in the structured workbench debug state

#### Scenario: Test performs programmatic selection
- **WHEN** a Playwright test or coding agent invokes the documented target-selection helper from the dev debug namespace
- **THEN** the selection request dispatches through the editor event contract
- **AND** the resulting structured state reflects the accepted selection

#### Scenario: Test reads recent trace entries
- **WHEN** a Playwright test calls the documented trace accessor on the dev debug namespace
- **THEN** it receives bounded recent trace entries from the editor-runtime debug recorder

### Requirement: State bridge SHALL be absent in production builds
The system SHALL gate the browser debug namespace behind dev or test build flags so production bundles do not expose the bridge code or the `window` property.

#### Scenario: Production build does not expose bridge
- **WHEN** the application is built for production
- **THEN** the browser debug namespace is `undefined`
