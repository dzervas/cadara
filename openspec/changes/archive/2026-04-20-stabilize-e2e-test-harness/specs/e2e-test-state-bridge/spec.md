## ADDED Requirements

### Requirement: Dev-only structured state bridge SHALL expose editor state on window
The system SHALL expose a `window.__cadTestState` object in dev/test mode that mirrors the `WorkbenchStateDebuggerModel` fields: `machineState`, `command`, `phase`, `selectionCount`, `selectionTargets`, `revision`, `featureSession`, `previewState`, `sketchSession`, `sketchPlane`, and `snapshotDiagnosticsCount`. The object SHALL be updated in the same React render cycle as the state debugger component.

#### Scenario: Test reads machine state from bridge
- **WHEN** a Playwright test calls `page.evaluate(() => window.__cadTestState.machineState)`
- **THEN** the returned value matches the current editor state machine state label

#### Scenario: Test reads selection targets from bridge
- **WHEN** a Playwright test calls `page.evaluate(() => window.__cadTestState.selectionTargets)`
- **THEN** the returned value contains the same target identifiers currently rendered in the state debugger's "Selection targets" row

#### Scenario: Test reads feature session from bridge
- **WHEN** a feature session is active and a Playwright test calls `page.evaluate(() => window.__cadTestState.featureSession)`
- **THEN** the returned value contains the session state label (e.g., `create:extrude:previewReady`)

#### Scenario: Test reads revision from bridge
- **WHEN** a document snapshot is loaded and a Playwright test calls `page.evaluate(() => window.__cadTestState.revision)`
- **THEN** the returned value contains the current revision identifier, not `loading`

### Requirement: State bridge SHALL be absent in production builds
The system SHALL gate the `window.__cadTestState` assignment behind `import.meta.env.DEV` or an equivalent build-time flag so that production bundles do not include the bridge code or the window property.

#### Scenario: Production build does not expose bridge
- **WHEN** the application is built with `NODE_ENV=production`
- **THEN** `window.__cadTestState` is `undefined`
