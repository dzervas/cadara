# e2e-programmatic-selection Specification

## Purpose
TBD - created by archiving change stabilize-e2e-test-harness. Update Purpose after archive.
## Requirements
### Requirement: Dev-only programmatic selection bridge SHALL select targets by ID
The system SHALL expose a `window.__cadSelectTarget(targetId: string)` function in dev/test mode that dispatches a selection through the editor state machine's existing selection action for the given topology target ID. The function SHALL return `true` if the target was found and selected, or `false` if the target ID is not selectable in the current state.

#### Scenario: Test selects a body by ID
- **WHEN** a test calls `page.evaluate((id) => window.__cadSelectTarget(id), 'body_feature_extrude-1')` while the editor accepts body selections
- **THEN** the editor state machine transitions as if the user clicked that body in the viewport, and `window.__cadTestState.selectionTargets` includes the body ID

#### Scenario: Test selects a face by ID
- **WHEN** a test calls `page.evaluate((id) => window.__cadSelectTarget(id), faceId)` while a feature session accepts face selections
- **THEN** the face is applied to the active feature draft's selection requirement

#### Scenario: Test selects an edge by ID
- **WHEN** a test calls `page.evaluate((id) => window.__cadSelectTarget(id), edgeId)` while a feature session accepts edge selections
- **THEN** the edge is applied to the active feature draft's selection requirement

#### Scenario: Unselectable target returns false
- **WHEN** a test calls `window.__cadSelectTarget(targetId)` with a target that is not selectable in the current selection filter
- **THEN** the function returns `false` and the selection state does not change

### Requirement: Programmatic selection bridge SHALL be absent in production builds
The system SHALL gate the `window.__cadSelectTarget` function behind `import.meta.env.DEV` or an equivalent build-time flag so that production bundles do not include the bridge code.

#### Scenario: Production build does not expose selection bridge
- **WHEN** the application is built with `NODE_ENV=production`
- **THEN** `window.__cadSelectTarget` is `undefined`

