# e2e-viewport-projection-bridge Specification

## Purpose
TBD - created by archiving change stabilize-e2e-test-harness. Update Purpose after archive.
## Requirements
### Requirement: Dev-only projection bridge SHALL map topology IDs to viewport coordinates
The system SHALL expose a `window.__cadProjectToScreen(objectId: string)` function in dev/test mode that returns the viewport-relative pixel coordinates `{ x: number, y: number }` for the centroid of the Three.js scene object matching the given topology target ID. The function SHALL return `null` if the object is not found in the scene graph or is not within the camera frustum.

#### Scenario: Test resolves a face target to viewport coordinates
- **WHEN** a body with face `body_feature_extrude-1.face_body_feature_extrude-1_t0001_6` is rendered and a test calls `page.evaluate((id) => window.__cadProjectToScreen(id), faceId)`
- **THEN** the returned coordinates point to a location within the viewport where clicking would select that face

#### Scenario: Test resolves an edge target to viewport coordinates
- **WHEN** a body with a durable edge is rendered and a test calls `page.evaluate((id) => window.__cadProjectToScreen(id), edgeId)`
- **THEN** the returned coordinates point to a location within the viewport where clicking would select that edge

#### Scenario: Off-screen target returns null
- **WHEN** a test calls `window.__cadProjectToScreen(objectId)` for an object that is not within the camera frustum
- **THEN** the function returns `null`

#### Scenario: Unknown target returns null
- **WHEN** a test calls `window.__cadProjectToScreen(objectId)` with an ID that does not exist in the scene graph
- **THEN** the function returns `null`

### Requirement: Projection bridge SHALL be absent in production builds
The system SHALL gate the `window.__cadProjectToScreen` function behind `import.meta.env.DEV` or an equivalent build-time flag so that production bundles do not include the bridge code.

#### Scenario: Production build does not expose projection bridge
- **WHEN** the application is built with `NODE_ENV=production`
- **THEN** `window.__cadProjectToScreen` is `undefined`

