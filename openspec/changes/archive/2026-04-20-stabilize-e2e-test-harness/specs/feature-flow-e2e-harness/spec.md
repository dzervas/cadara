## MODIFIED Requirements

### Requirement: Feature flow tests SHALL use a reusable Playwright harness
The system SHALL provide a lightweight Playwright harness for feature testing that can open the workbench, create deterministic sketch/body fixtures, activate feature tools, set feature form values, select durable viewport targets, preview features, commit features, and compose multiple feature steps in a single scenario. State reads (machine state, selection targets, revision, feature session, preview diagnostics) SHALL use the structured `window.__cadTestState` bridge instead of regex-based `body.textContent()` scraping. Viewport geometry selection for non-picking tests SHALL use the programmatic `window.__cadSelectTarget()` bridge or the coordinate projection `window.__cadProjectToScreen()` bridge instead of hardcoded pixel coordinate maps. Canvas frame stability checks SHALL use the `data-render-idle` DOM attribute instead of screenshot byte-delta comparison.

#### Scenario: Single feature flow uses shared helpers
- **WHEN** an e2e test creates a base sketch and runs a single feature operation
- **THEN** the test uses shared harness helpers for setup, feature activation, target selection, parameter entry, preview observation, and commit verification

#### Scenario: Multi-feature chain uses shared helpers
- **WHEN** an e2e test runs a sequence such as sketch profile, extrude, fillet, shell, and boolean
- **THEN** the harness preserves the workbench document state across steps and exposes helper results that later steps can use without duplicating setup logic

#### Scenario: State reads use structured bridge
- **WHEN** the harness reads machine state, selection targets, revision, or feature session
- **THEN** the harness calls `page.evaluate(() => window.__cadTestState.<field>)` instead of parsing `body.textContent()` with regex

#### Scenario: Viewport selection uses projection or programmatic bridge
- **WHEN** the harness selects a geometry target in the viewport for a non-picking test
- **THEN** the harness resolves coordinates via `window.__cadProjectToScreen()` or dispatches selection via `window.__cadSelectTarget()` instead of using hardcoded pixel offsets

#### Scenario: Canvas stability uses render-idle signal
- **WHEN** the harness waits for the viewport to settle after a commit or reload
- **THEN** the harness awaits `[data-render-idle="true"]` instead of polling screenshot byte-delta comparisons

### Requirement: Feature selection SHALL expose required durable target kinds
The system SHALL expose viewport selection targets required by active feature authoring definitions, including durable edges for fillet, durable faces for shell and plane, durable bodies for boolean scope, and profile/axis references for revolve.

#### Scenario: Fillet can select body edges
- **WHEN** the fillet feature session is active and the viewport contains a body with durable edges
- **THEN** hovering and clicking a selectable edge applies that edge to the fillet draft

#### Scenario: Feature-specific filters preserve target intent
- **WHEN** a feature session declares a target filter for edges, faces, bodies, profiles, axes, or constructions
- **THEN** the viewport selection path only applies accepted targets to the feature draft and leaves rejected targets out of the draft
