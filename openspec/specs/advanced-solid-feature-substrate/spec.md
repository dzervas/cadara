# advanced-solid-feature-substrate Specification

## Purpose
TBD - created by archiving change advanced-solid-feature-substrate. Update Purpose after archive.
## Requirements
### Requirement: Advanced features SHALL declare typed participant roles
Each advanced solid feature definition SHALL declare its required and optional participant roles using explicit typed categories rather than unstructured reference arrays.

#### Scenario: Feature declares profile and path participants
- **WHEN** a profile/path feature such as sweep or loft is registered
- **THEN** its authoring definition declares role-specific participants such as profiles, paths, guide curves, or sections with accepted durable reference kinds for each role

#### Scenario: Feature declares topology modifier participants
- **WHEN** a topology modifier such as face blend, chamfer, hole, or external thread is registered
- **THEN** its authoring definition declares role-specific participants such as faces, edges, axes, placement references, or target bodies with accepted durable reference kinds for each role

#### Scenario: Feature declares body operation participants
- **WHEN** a body operation such as thicken, split, delete-solid, mirror, transform, or enclose is registered
- **THEN** its authoring definition declares role-specific participants such as target bodies, tool bodies, faces, planes, axes, transform references, or enclosing-region seeds with accepted durable reference kinds for each role

### Requirement: Advanced features SHALL declare supported operation intent
Each advanced solid feature definition that can create or combine solid geometry SHALL declare the operation intents it supports, including `create`, `add`, `subtract`, and `intersect` only where each mode is valid for that feature.

#### Scenario: Feature supports boolean participation
- **WHEN** an advanced feature supports adding, subtracting, or intersecting with existing solids
- **THEN** its authoring definition exposes those supported operation modes and declares the target-body participants required by each non-create mode

#### Scenario: Feature does not support a global operation mode
- **WHEN** an operation mode is not meaningful for a feature kind
- **THEN** the feature authoring definition does not expose that mode and preview or commit validation rejects payloads that request it

### Requirement: Advanced feature authoring SHALL expose machine-readable selection requirements
Each advanced solid feature authoring definition SHALL expose selection requirements that let the editor runtime drive target picking, reference display, missing-input diagnostics, preview readiness, and commit readiness without feature-specific UI branching.

#### Scenario: Editor starts collecting a participant
- **WHEN** the user activates an advanced feature or chooses a participant field in its editor form
- **THEN** the editor runtime resolves the active participant role, accepted target kinds, cardinality, and required/optional status from the feature authoring definition

#### Scenario: Selected target is accepted
- **WHEN** the user selects a durable target that matches the active participant role requirements
- **THEN** the feature authoring definition applies the target to the draft state while preserving the target's participant role

#### Scenario: Selected target is rejected
- **WHEN** the user selects a durable target that does not match the active participant role requirements
- **THEN** the editor reports a role-specific diagnostic rather than coercing the target into another role or silently ignoring the selection

### Requirement: Advanced feature payloads SHALL preserve participant intent
Advanced solid feature modeling definitions, operation-history entries, and snapshot hydration data SHALL preserve participant roles and operation intent so an authored feature can round-trip without relying on UI order or kernel-specific topology assumptions.

#### Scenario: Feature snapshot is hydrated for editing
- **WHEN** the user edits a committed advanced feature
- **THEN** the editor draft is hydrated from role-specific participant fields and operation intent rather than from positional reference arrays

#### Scenario: Operation history replays an advanced feature
- **WHEN** operation history replays an advanced feature request
- **THEN** the request carries the same role-specific participants and operation intent that were committed originally

### Requirement: Advanced feature previews SHALL be explicit about incomplete or unsupported inputs
Advanced solid feature previews SHALL return structured diagnostics for missing required participants, invalid participant combinations, invalid operation intent, and unsupported kernel cases.

#### Scenario: Required participant is missing
- **WHEN** preview is requested for an advanced feature draft with a missing required participant
- **THEN** the preview response or authoring validation reports the missing participant by role and does not commit document changes

#### Scenario: Kernel does not support a valid contract shape
- **WHEN** the modeling adapter receives a contract-valid advanced feature definition whose geometric combination is not yet supported by the kernel implementation
- **THEN** the adapter returns an unsupported-case diagnostic rather than dropping participants, changing operation intent, or guessing alternate geometry

### Requirement: Advanced feature implementation SHALL remain behind the modeling boundary
Advanced solid feature authoring and UI code SHALL depend on public modeling contracts and feature authoring definitions, and MUST NOT import kernel-specific modules or encode OCC-specific construction behavior in presentational components.

#### Scenario: Generic inspector renders an advanced feature
- **WHEN** the generic feature inspector renders an advanced feature editor
- **THEN** it consumes the feature's form schema and selection descriptors without importing OCC modules or feature-specific kernel helpers

#### Scenario: Feature preview or commit reaches the kernel
- **WHEN** an advanced feature preview or commit is requested
- **THEN** the request flows through the modeling service and kernel adapter boundary rather than direct UI-to-kernel calls

### Requirement: Advanced feature rollout SHALL proceed through feature-family slices
The system SHALL use the advanced solid substrate as a prerequisite for follow-up feature-family changes rather than treating the entire missing-feature list as one implementation batch.

#### Scenario: Follow-up feature proposal is created
- **WHEN** a proposal adds a feature such as sweep, loft, thicken, enclose, face blend, chamfer, hole, external thread, mirror, split, transform, wrap, or delete-solid
- **THEN** the proposal identifies which substrate participant roles, operation modes, diagnostics, and adapter obligations the feature uses or extends

#### Scenario: Enclose is proposed
- **WHEN** the enclose feature is proposed as a follow-up
- **THEN** the proposal explicitly defines the supported enclosing-region seeds and boolean operation modes instead of inheriting ambiguous behavior from other body operations

### Requirement: Advanced feature milestone completion SHALL include e2e coverage
The advanced-feature milestone SHALL NOT be considered complete until each implemented advanced feature has an e2e test flow comparable to the existing extrude and basic-feature e2e coverage.

#### Scenario: Implemented feature reaches milestone completion
- **WHEN** an advanced feature such as sweep, loft, thicken, enclose, face blend, chamfer, hole, external thread, mirror, split, transform, wrap, or delete-solid has been implemented for the milestone
- **THEN** the milestone includes an e2e test that exercises the feature's user-facing flow through tool activation, required selection, preview or validation feedback, commit, and resulting document or geometry state

#### Scenario: Feature intentionally rejects an unsupported geometry case
- **WHEN** an implemented advanced feature has an e2e path for a contract-valid but kernel-unsupported case
- **THEN** the e2e test verifies structured user-visible diagnostics rather than silent failure or document mutation

### Requirement: Advanced substrate SHALL include Combine as a body operation feature
The advanced solid feature substrate SHALL include Combine as a concrete body operation feature with explicit target-body and tool-body participant roles.

#### Scenario: Combine declares participant roles
- **WHEN** Combine is registered as an advanced solid feature
- **THEN** its authoring descriptor declares target-body and tool-body participants with durable body target kinds

#### Scenario: Combine declares supported boolean intents
- **WHEN** the editor or modeling boundary inspects Combine operation support
- **THEN** Combine declares `add`, `subtract`, and `intersect` as supported operation intents
- **AND** each operation requires both target-body and tool-body participants

#### Scenario: Combine rejects unsupported operation intent
- **WHEN** a Combine definition contains an operation intent outside `add`, `subtract`, or `intersect`
- **THEN** advanced feature validation returns an unsupported-operation diagnostic

