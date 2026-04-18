## ADDED Requirements

### Requirement: Canonical Application Error Contract
The system SHALL represent every handled application failure with a canonical error object that includes a stable code, severity, human-readable message, structured context, optional original cause, and optional request or target correlation.

#### Scenario: Unknown thrown value is normalized
- **WHEN** a boundary catches an unknown thrown or rejected value
- **THEN** the system SHALL convert it into a canonical application error with a fallback message and structured context before reporting or returning it

#### Scenario: Domain context is preserved
- **WHEN** an error moves through modeling, editor, or workbench boundaries
- **THEN** each boundary SHALL attach relevant context such as operation name, request id, document revision, feature id, or target without discarding the original cause

### Requirement: Neverthrow Boundary Results
The system SHALL use neverthrow `Result` or `ResultAsync` at application boundaries where failures are expected or recoverable, including async service calls, runtime contract validation, storage/repository operations, and workbench action execution.

#### Scenario: Expected failure returns a result
- **WHEN** a boundary operation can fail due to validation, rejected modeling input, stale revision, storage unavailability, or adapter rejection
- **THEN** the operation SHALL return or adapt a neverthrow error result instead of requiring callers to catch a raw exception

#### Scenario: Programmer invariant can still throw
- **WHEN** code detects an impossible internal invariant or provider misuse
- **THEN** the code MAY throw, but the nearest action, effect, actor, or render boundary SHALL normalize and report the failure before it reaches the user

### Requirement: Central Error Reporter
The system SHALL route normalized application errors through a central reporter abstraction that supports console reporting now and later extension to a Sentry-like tracking transport.

#### Scenario: Error is reported to console
- **WHEN** a normalized application error is reported in development or test mode
- **THEN** the reporter SHALL emit an actionable console record containing the error code, human message, severity, and structured context

#### Scenario: Future tracking transport is isolated
- **WHEN** a Sentry-like tracking sink is introduced
- **THEN** it SHALL be added behind the reporter abstraction without importing tracking vendor APIs into domain, modeling, editor, or presentational component modules

#### Scenario: Duplicate reporting is controlled
- **WHEN** the same failure passes through multiple reporting-aware boundaries
- **THEN** the reporter SHALL avoid noisy duplicate user notifications or duplicate telemetry records for the same operation where a dedupe key or already-reported marker is available

### Requirement: User-Visible Error Reporting
The system SHALL surface user-action failures in the UI through existing workbench status, notification, or diagnostic surfaces while preserving a human-readable error message.

#### Scenario: Workbench action fails
- **WHEN** a user-triggered workbench action fails or receives a rejected modeling result
- **THEN** the user SHALL see a workbench notification or status message that explains the failure in human-readable language

#### Scenario: Modeling failure has a target
- **WHEN** a modeling, feature, sketch, or preview failure includes a durable target or edit-session context
- **THEN** the system SHALL expose the failure as a modeling diagnostic or equivalent UI affordance associated with that context

#### Scenario: Render crash is caught
- **WHEN** a React render subtree throws an unexpected error
- **THEN** an error boundary SHALL show a fallback UI and report the normalized error through the central reporter

### Requirement: Editor Runtime Failure Funnel
The system SHALL funnel editor effect and actor failures into typed editor events or normalized reported errors so that no effect rejection is silently lost.

#### Scenario: Editor effect catches expected failure
- **WHEN** an editor effect operation rejects or throws during snapshot loading, sketch session opening, feature preview, feature commit, sketch commit, reference projection, or cursor movement
- **THEN** `runEditorEffect` SHALL convert the failure into a typed failure event carrying the normalized human message and context

#### Scenario: XState invocation escapes unexpectedly
- **WHEN** an invoked editor actor rejects outside the normal typed effect-event conversion
- **THEN** the runtime SHALL handle the invocation error, normalize it, report it, and move to a recoverable editor state rather than dropping the error

### Requirement: Workbench Action Failure Funnel
The system SHALL execute modeling-service-facing workbench actions through a shared helper that normalizes failures, reports them, and returns a typed success or failure result to the caller.

#### Scenario: Action helper handles rejected promise
- **WHEN** a workbench action promise rejects
- **THEN** the action helper SHALL normalize the rejection, report it through the central reporter, update the configured UI error surface, and return an error result

#### Scenario: Action helper handles rejected modeling result
- **WHEN** a modeling service response returns diagnostics with a non-accepted revision state
- **THEN** the action helper SHALL map the first actionable diagnostic into the user-visible message while preserving all diagnostics in error context

### Requirement: No Empty Catch Blocks
The system SHALL prohibit empty catch blocks in application, test, and Playwright source files; caught errors MUST be reported, transformed into a typed result, or rethrown.

#### Scenario: Empty catch is rejected
- **WHEN** a source file contains a catch block with no statements
- **THEN** linting or the dedicated static test SHALL fail with a message explaining that caught errors must be handled, reported, converted, or rethrown

#### Scenario: Intentional suppression is explicit
- **WHEN** a caught error is intentionally ignored because the operation is best-effort
- **THEN** the catch block SHALL call an approved helper or include an explicit reporting/normalization path so the suppression is searchable and reviewable

### Requirement: Erroneous Flow E2E Coverage
The system SHALL include Playwright tests for representative erroneous user actions that verify errors are reported through the UI and/or console.

#### Scenario: Erroneous action reports failure
- **WHEN** an E2E test triggers a supported erroneous workbench action
- **THEN** the test SHALL assert that a human-readable error appears in the workbench UI or an actionable error record appears in the browser console

#### Scenario: E2E checks fail on silent error
- **WHEN** the same erroneous action neither shows a UI error nor emits a console error record
- **THEN** the E2E test SHALL fail
