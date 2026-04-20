# e2e-render-idle-signal Specification

## Purpose
TBD - created by archiving change stabilize-e2e-test-harness. Update Purpose after archive.
## Requirements
### Requirement: Viewport SHALL signal render-idle state via a DOM attribute
The system SHALL set a `data-render-idle="true"` attribute on the viewport container element when the Three.js render loop has produced stable frames (frame-to-frame delta below an internal threshold) for a minimum number of consecutive frames AND no pending modeling operations exist in the editor state machine. The attribute SHALL be removed or set to `"false"` when rendering activity resumes.

#### Scenario: Render loop becomes idle after feature commit
- **WHEN** a feature is committed and the geometry rebuild completes
- **THEN** the viewport container element has `data-render-idle="true"` within a bounded time

#### Scenario: Render loop is active during preview
- **WHEN** a feature preview is being computed or the scene is animating
- **THEN** the viewport container element does not have `data-render-idle="true"`

#### Scenario: Test waits for render idle
- **WHEN** a Playwright test calls `page.waitForSelector('[data-render-idle="true"]', { timeout })`
- **THEN** the test resumes only after the viewport has settled to a stable rendering state

### Requirement: Render-idle signal SHALL reflect modeling pipeline completion
The system SHALL not signal render-idle while the editor state machine has pending operations (e.g., geometry rebuild, kernel evaluation). The idle signal SHALL require both visual frame stability AND state machine idle state.

#### Scenario: Geometry rebuild delays idle signal
- **WHEN** the render loop frames are visually stable but a geometry rebuild is still in progress
- **THEN** `data-render-idle` remains `"false"` until the rebuild completes and frames re-stabilize

