# feature-flow-e2e-harness Specification

## Purpose
TBD - created by archiving change stabilize-basic-feature-e2e-harness. Update Purpose after archive.
## Requirements
### Requirement: Feature flow tests SHALL use a reusable Playwright harness
The system SHALL provide a lightweight Playwright harness for feature testing that can open the workbench, create deterministic sketch/body fixtures, activate feature tools, set feature form values, select durable viewport targets, preview features, commit features, and compose multiple feature steps in a single scenario.

#### Scenario: Single feature flow uses shared helpers
- **WHEN** an e2e test creates a base sketch and runs a single feature operation
- **THEN** the test uses shared harness helpers for setup, feature activation, target selection, parameter entry, preview observation, and commit verification

#### Scenario: Multi-feature chain uses shared helpers
- **WHEN** an e2e test runs a sequence such as sketch profile, extrude, fillet, shell, and boolean
- **THEN** the harness preserves the workbench document state across steps and exposes helper results that later steps can use without duplicating setup logic

### Requirement: Supported feature flows SHALL have Playwright coverage
The system SHALL include Playwright e2e coverage for extrude, revolve, fillet, shell, plane, and boolean feature flows through the workbench UI.

#### Scenario: Extrude remains covered
- **WHEN** the e2e suite runs the extrude feature flow
- **THEN** a valid sketch profile can be selected, previewed, and committed without runtime errors or failed diagnostics

#### Scenario: Revolve is covered
- **WHEN** the e2e suite runs the revolve feature flow with a valid profile and durable edge-backed axis
- **THEN** the feature can be previewed and committed without runtime errors or failed diagnostics

#### Scenario: Fillet is covered
- **WHEN** the e2e suite runs the fillet feature flow against one or more durable body edges
- **THEN** the edges are selectable in the viewport and the feature can be previewed and committed without runtime errors or failed diagnostics

#### Scenario: Shell is covered
- **WHEN** the e2e suite runs the shell feature flow against a valid body and removable face
- **THEN** the feature can be previewed and committed without runtime errors or failed diagnostics

#### Scenario: Plane is covered
- **WHEN** the e2e suite runs the plane feature flow from a supported construction plane or planar face reference
- **THEN** the construction plane feature can be previewed and committed without runtime errors or failed diagnostics

#### Scenario: Boolean is covered
- **WHEN** the e2e suite runs a boolean feature flow with deterministic target bodies and explicit boolean scope
- **THEN** the boolean operation can be previewed and committed without runtime errors or failed diagnostics

### Requirement: Feature selection SHALL expose required durable target kinds
The system SHALL expose viewport selection targets required by active feature authoring definitions, including durable edges for fillet, durable faces for shell and plane, durable bodies for boolean scope, and profile/axis references for revolve.

#### Scenario: Fillet can select body edges
- **WHEN** the fillet feature session is active and the viewport contains a body with durable edges
- **THEN** hovering and clicking a selectable edge applies that edge to the fillet draft

#### Scenario: Feature-specific filters preserve target intent
- **WHEN** a feature session declares a target filter for edges, faces, bodies, profiles, axes, or constructions
- **THEN** the viewport selection path only applies accepted targets to the feature draft and leaves rejected targets out of the draft

### Requirement: Shell render output SHALL be visually stable
The system SHALL render shell feature results with stable material and color assignment so the resulting body interior does not flicker or display excessive transient coloring after preview or commit.

#### Scenario: Shell commit has stable viewport coloring
- **WHEN** a shell feature is committed and the viewport renders the resulting body
- **THEN** the body interior uses stable material assignment across consecutive frames

#### Scenario: Shell preview does not pollute committed materials
- **WHEN** a shell preview is evaluated before commit
- **THEN** transient preview coloring does not remain on the committed body after the feature is created

