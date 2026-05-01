## MODIFIED Requirements

### Requirement: Repository unit and integration specs SHALL run through Bun's native test harness in explicit lanes
The repository SHALL execute non-Playwright `.spec.ts` and `.spec.tsx` coverage through `bun:test` rather than through raw TypeScript entrypoint scripts, and the Bun-managed suite SHALL support explicit `logic`, `ui`, and `static` execution lanes instead of treating all non-Playwright specs as one undifferentiated suite.

#### Scenario: Running the logic lane
- **WHEN** a developer runs the repository command for non-UI logic coverage
- **THEN** Bun discovers and executes the repository's supported `logic`-lane specs through `bun:test`
- **AND** the command targets non-UI behavioral coverage rather than UI rendering or repository policy guards

#### Scenario: Running the UI lane
- **WHEN** a developer runs the repository command for UI-local coverage
- **THEN** Bun discovers and executes the repository's supported `ui`-lane specs through `bun:test`
- **AND** the workflow remains distinct from the non-UI coverage target

#### Scenario: Running the static lane
- **WHEN** a developer runs the repository command for static policy enforcement
- **THEN** Bun discovers and executes the repository's supported `static`-lane checks through `bun:test`
- **AND** the checks remain isolated from browser-based e2e execution

### Requirement: Public test scripts SHALL expose lane-aware workflows and umbrella commands
The repository SHALL expose lane-aware top-level test commands for Bun-managed non-Playwright coverage while preserving umbrella entrypoints for ordinary developer use.

#### Scenario: Inspecting package test commands
- **WHEN** a developer reviews the repository's package scripts after the refactor
- **THEN** the repository exposes top-level workflows for `logic`, `ui`, `static`, `test`, and `test:e2e`
- **AND** the ordinary `test` flow remains available as an umbrella command rather than forcing contributors to memorize only raw Bun arguments

#### Scenario: Running the standard repository suite
- **WHEN** a developer runs the repository `test` script
- **THEN** the repository executes the intended umbrella Bun-managed suite for the refactored non-Playwright lanes
- **AND** the workflow does not require separate raw TypeScript entrypoint scripts for those checks

## ADDED Requirements

### Requirement: Non-UI coverage SHALL be emitted from the Bun logic lane
The repository SHALL provide a Bun-managed coverage workflow for the `logic` lane so the team can measure non-UI code independently from UI and static checks.

#### Scenario: Running non-UI coverage
- **WHEN** a developer runs the repository coverage workflow for non-UI code
- **THEN** Bun emits coverage data from `logic`-lane execution
- **AND** the resulting report excludes UI-lane tests and static policy checks from the measured target
