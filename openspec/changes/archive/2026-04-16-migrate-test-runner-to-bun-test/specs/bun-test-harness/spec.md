## ADDED Requirements

### Requirement: Repository unit and integration specs SHALL run through Bun's native test harness
The repository SHALL execute non-Playwright `.spec.ts` and `.spec.tsx` coverage through `bun:test` rather than through raw TypeScript entrypoint scripts.

#### Scenario: Running the standard non-e2e suite
- **WHEN** a developer runs the repository `test` script
- **THEN** Bun discovers and executes the repository's supported non-Playwright spec files through `bun:test`
- **THEN** the workflow does not require separate script-per-suite entrypoints for those specs

#### Scenario: Migrating a top-level spec file
- **WHEN** an existing spec file currently depends on top-level execution instead of a registered harness test case
- **THEN** the repository provides a minimal adaptation so that Bun can run the same assertions through `bun:test`
- **THEN** the migration does not require changing the test's intended behavioral coverage

### Requirement: Playwright SHALL remain the dedicated e2e harness
The repository SHALL keep Playwright as the dedicated browser e2e runner and SHALL not route e2e specs through `bun:test`.

#### Scenario: Running end-to-end coverage
- **WHEN** a developer runs the repository `test:e2e` script
- **THEN** the repository executes Playwright tests using the existing Playwright harness
- **THEN** browser-based e2e execution remains isolated from the Bun unit and integration harness

### Requirement: Public test scripts SHALL be limited to `test` and `test:e2e`
The repository SHALL expose only `test` and `test:e2e` as its supported top-level test scripts after the migration.

#### Scenario: Inspecting package test commands
- **WHEN** a developer reviews the repository's package scripts after this migration
- **THEN** the supported top-level test commands are `test` for Bun-managed non-e2e coverage and `test:e2e` for Playwright
- **THEN** the prior raw-TypeScript script aliases are no longer part of the supported script contract
