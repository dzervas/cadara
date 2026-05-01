## ADDED Requirements

### Requirement: Repository tests SHALL be classified into explicit lanes
The repository SHALL classify automated tests into four explicit lanes: `logic`, `ui`, `e2e`, and `static`. Each lane SHALL have a distinct subject of proof and placement policy so contributors do not treat all `*.spec.ts` files as interchangeable.

#### Scenario: New non-UI behavior is added
- **WHEN** a contributor adds coverage for behavior in `contracts`, `core`, `domain`, `application`, or an appropriate `infrastructure` module
- **THEN** the test is classified into the `logic` lane
- **AND** the test is not placed into a UI or browser-driven lane merely because a nearby UI surface also depends on the behavior

#### Scenario: New presentational behavior is added
- **WHEN** a contributor adds coverage for behavior owned by `app`, `components`, or `hooks`
- **THEN** the test is classified into the `ui` lane
- **AND** the test does not become part of the non-UI coverage target by default

#### Scenario: New browser flow is added
- **WHEN** a contributor adds coverage for a workbench flow that must run through the browser shell
- **THEN** the test is classified into the `e2e` lane
- **AND** the test runs through Playwright rather than Bun's non-browser harness

#### Scenario: New repository policy guard is added
- **WHEN** a contributor adds an import-boundary check, source-scan policy guard, or similar repository-wide enforcement rule
- **THEN** the test is classified into the `static` lane
- **AND** it is not counted as ordinary behavioral coverage

### Requirement: Non-UI coverage SHALL be measured from the logic lane
The repository SHALL measure the coverage target for code that does not touch the UI from the `logic` lane only. UI-local tests and static policy checks SHALL be excluded from that non-UI coverage accounting.

#### Scenario: Logic coverage is reported
- **WHEN** the repository emits coverage for the non-UI code target
- **THEN** the reported coverage is derived from `logic` lane execution
- **AND** UI-lane tests do not raise or satisfy that coverage target

#### Scenario: Static checks are present
- **WHEN** repository-level static guards run successfully
- **THEN** those guards remain required enforcement
- **AND** they do not count toward the non-UI behavioral coverage target

### Requirement: Non-UI tests SHALL prove exported seams by layer
The repository SHALL define non-UI test seams by layer and SHALL default new coverage to exported boundaries instead of private helper reach-in.

#### Scenario: Contract behavior is tested
- **WHEN** a contributor adds coverage for a contract or runtime schema
- **THEN** the test proves parse, validation, normalization, serialization, or versioned payload behavior at the exported contract boundary
- **AND** it does not use a UI surface as the primary proof of that behavior

#### Scenario: Domain behavior is tested
- **WHEN** a contributor adds coverage for `core` or `domain` logic
- **THEN** the test exercises exported reducers, registries, solvers, operation builders, or state-transition surfaces
- **AND** it does not depend on a React component or unrelated orchestration shell to prove the behavior

#### Scenario: Application orchestration is tested
- **WHEN** a contributor adds coverage for `application` logic
- **THEN** the test proves sequencing, retries, handoff, or error propagation through mocked or fake collaborator ports
- **AND** it does not assert behavior only through a browser or presentational shell

#### Scenario: Infrastructure adapter behavior is tested
- **WHEN** a contributor adds coverage for an `infrastructure` module
- **THEN** the test proves adapter conformance against the contract expected by the consuming layer
- **AND** it does not default to incidental implementation-detail assertions when contract-level assertions can prove the same seam

### Requirement: Shared test support SHALL remain seam-scoped
The repository SHALL share fixtures, fakes, builders, and helper assertions only when they support a recurring seam across unrelated tests. Feature-local setup MAY remain local when it is not reused beyond its owning area.

#### Scenario: Repeated service-port setup appears in multiple suites
- **WHEN** multiple unrelated tests need the same application or adapter seam setup
- **THEN** the repository extracts a shared seam-scoped helper for that setup
- **AND** the helper API is named after the boundary it supports rather than after one incidental feature flow

#### Scenario: One feature area has unique setup
- **WHEN** setup is only needed by one module or one tightly related group of tests
- **THEN** the repository MAY keep that setup local to the owning tests
- **AND** it does not force the setup into a global shared harness prematurely

### Requirement: Static guards SHALL remain discoverable and separately executable
The repository SHALL keep cross-cutting static guards in a recognizable guard surface and SHALL support executing them separately from behavioral test lanes.

#### Scenario: Contributor reviews repository policy checks
- **WHEN** a contributor looks for source-scan or import-boundary enforcement
- **THEN** the guard files are discoverable as part of a dedicated static-check surface
- **AND** they are not hidden among unrelated behavioral specs without lane labeling

#### Scenario: Static lane runs independently
- **WHEN** the repository executes the static lane
- **THEN** architecture guards, import restrictions, and source-policy checks run without requiring browser execution
- **AND** the result can fail independently from UI or logic behavior
