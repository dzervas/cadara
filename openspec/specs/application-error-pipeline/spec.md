# application-error-pipeline Specification

## Purpose
TBD - created by archiving change application-error-pipeline. Update Purpose after archive.
## Requirements
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

### Requirement: Production Sentry Telemetry Transport
The system SHALL report normalized production application errors through a Sentry-compatible telemetry transport configured with the Bugsink DSN `https://0f8f70678fa14347ad0d762e7db3c74c@errors.dzerv.art/1`, while preserving the central `ErrorReporter` abstraction.

#### Scenario: Production error reaches Bugsink transport
- **WHEN** the app runs from a production build and a normalized application error is reported
- **THEN** the default reporter SHALL send the event through the Sentry-compatible transport
- **AND** the event SHALL include the application error code, severity, message, source metadata, tags or fingerprint metadata, and the original stack trace when the original cause provides one

#### Scenario: Non-production reporting stays local
- **WHEN** the app runs in development or tests without an explicitly injected reporter
- **THEN** the default reporter SHALL use the existing local reporter behavior
- **AND** it SHALL NOT initialize or send events to the Bugsink transport

#### Scenario: Vendor APIs remain isolated
- **WHEN** domain, modeling, editor, or presentational modules report an application error
- **THEN** those modules SHALL depend only on the existing application error reporter contract
- **AND** they SHALL NOT import Sentry or Bugsink SDK APIs directly

### Requirement: Active Document Telemetry Context
Production telemetry events SHALL include the current active durable document payload when a document is loaded, plus compact identity and revision metadata suitable for filtering and diagnostics.

#### Scenario: Loaded document is attached to production error
- **WHEN** a production error is reported while the editor has a loaded document snapshot
- **THEN** the telemetry event SHALL include the active document id, revision id, schema version, and durable authored document payload derived from the current snapshot
- **AND** the payload SHALL exclude derived render exports, OpenCascade runtime objects, preview geometry, hover state, and other transient presentation state

#### Scenario: No active document is available
- **WHEN** a production error is reported before any document snapshot is loaded or after the active document context is cleared
- **THEN** the telemetry event SHALL still be sent
- **AND** the event SHALL mark the active document context as unavailable instead of throwing a secondary reporting error

#### Scenario: Document payload cannot be accepted
- **WHEN** the active durable document payload cannot be serialized or exceeds a hard telemetry transport limit
- **THEN** the telemetry event SHALL include the document id, revision id, and an explicit marker explaining why the full document payload was omitted or truncated
- **AND** the reporting failure SHALL NOT mask the original application error

### Requirement: Source-Mapped Production Builds
Production builds SHALL emit JavaScript source maps and ship them with the built assets so Bugsink can resolve minified browser stack traces to meaningful source locations.

#### Scenario: Production build emits source maps
- **WHEN** the production build command runs
- **THEN** Vite SHALL emit source-map files for bundled JavaScript assets
- **AND** the built JavaScript assets SHALL retain source-map references suitable for the deployed open-source app

#### Scenario: Stack trace can reference source locations
- **WHEN** a production telemetry event contains a JavaScript stack trace from a bundled asset
- **THEN** the deployed source maps SHALL be available to the Bugsink-compatible stack trace processing flow
- **AND** the resulting issue SHALL be able to show meaningful source file and line information instead of only minified bundle offsets

### Requirement: User-Visible Error Reporting
The system SHALL surface user-action failures in the UI through existing workbench status, notification, or diagnostic surfaces while preserving a human-readable error message, and notification-based failure surfaces SHALL use error-typed workbench notification presentation.

#### Scenario: Workbench action fails
- **WHEN** a user-triggered workbench action fails or receives a rejected modeling result
- **THEN** the user SHALL see a workbench notification or status message that explains the failure in human-readable language
- **AND** when the failure is shown as a notification, it SHALL use the `error` notification type
- **AND** the notification SHALL remain visible until manually dismissed or replaced by a newer error for the same operation

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
The system SHALL execute modeling-service-facing workbench actions through a shared helper that normalizes failures, applies explicit reporting policy, surfaces configured UI failure state, and returns a typed success or failure result to the caller.

#### Scenario: Action helper handles rejected promise
- **WHEN** a workbench action promise rejects because of an unexpected exception or infrastructure failure
- **THEN** the action helper SHALL normalize the rejection, report it through the central reporter, update the configured UI error surface, and return an error result

#### Scenario: Action helper handles rejected modeling result
- **WHEN** a modeling service response returns diagnostics with a non-accepted revision state for an expected CAD/domain rejection
- **THEN** the action helper SHALL map the first actionable diagnostic into the user-visible message while preserving all diagnostics in error context
- **AND** the action helper SHALL NOT report the rejection as a defect unless the caller explicitly classifies that operation as reportable

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

### Requirement: Recoverable document errors SHALL use non-destructive recovery messaging
The system SHALL surface recoverable feature-scoped document errors as feature diagnostics and SHALL NOT present clearing, deleting, resetting, or starting from scratch as a valid fix for that state.

#### Scenario: Recoverable rebuild failure reaches UI
- **WHEN** a feature-scoped rebuild failure is shown to the user
- **THEN** the visible message directs the user to repair the marked feature field
- **AND** the message does not recommend clearing, deleting, resetting, or starting over the document

#### Scenario: Global fallback is not used for feature error
- **WHEN** a structurally valid document contains a repairable feature error
- **THEN** the error pipeline keeps the failure attached to modeling diagnostics for the feature
- **AND** it does not replace the workbench with a document-level fallback whose only repair action is destructive

#### Scenario: Unexpected application crash remains separate
- **WHEN** an unrelated unexpected React render crash or programmer invariant failure occurs
- **THEN** the application error boundary may still show its standard fallback and reporting behavior
- **AND** that fallback is not used to handle ordinary recoverable feature rebuild failures

### Requirement: Diagnostics SHALL summarize geometry asset failures without attaching large blobs
The application error pipeline SHALL report geometry asset availability, validation, and restore failures without embedding raw asset bytes in telemetry or bug-report payloads.

#### Scenario: Bug report for missing geometry asset
- **WHEN** the active document has a missing or corrupt geometry asset diagnostic
- **THEN** bug-report and telemetry context includes asset id, format, byte length, hash prefix, owner feature target, and diagnostic code
- **AND** raw STEP, baked geometry, STL, 3MF, or triangle payload bytes are omitted

### Requirement: Explicit Failure Reporting Classification
The system SHALL classify handled failures as either expected user/domain feedback or reportable defects before sending them to the central error reporter.

#### Scenario: Expected CAD failure is not reported by default
- **WHEN** a user action returns an expected CAD, modeling, sketch, validation, unsupported-input, permission-denied, cancellation, or loading-state failure
- **THEN** the system SHALL surface the failure through the appropriate diagnostic, status, or notification UI
- **AND** the system SHALL NOT send the failure to the central reporter solely because the user-visible surface is an error

#### Scenario: Caught unexpected defect is reported
- **WHEN** a workbench action catches an unexpected thrown exception, rejected promise, provider crash, storage failure, worker failure, OCC/runtime failure, or impossible internal invariant
- **THEN** the system SHALL normalize the failure into an application error
- **AND** the system SHALL report it through the central reporter with source, context, original cause when available, and dedupe metadata where appropriate
- **AND** the system SHALL surface a human-readable user message when the failure affects the current workflow

#### Scenario: Caller owns classification
- **WHEN** a failure is handled at a workbench controller, action helper, editor runtime, modeling service, or persistence boundary
- **THEN** that boundary SHALL choose the reporting classification using the operation context available at that boundary
- **AND** presentational notification components SHALL NOT infer telemetry policy from notification type

### Requirement: Document History Restore Failure Tracking
The system SHALL report document history restore failures through the central reporter while preserving the existing user-visible restore failure message.

#### Scenario: Restore failure is tracked and surfaced
- **WHEN** stored document history restore state is failed or restore diagnostics indicate saved operation history could not be replayed, decoded, or accepted
- **THEN** the system SHALL show the restore failure message to the user through the existing workbench restore/error surface
- **AND** the system SHALL report a normalized application error through the central reporter
- **AND** the report SHALL include source metadata identifying history restore, available document and revision context, and diagnostic code/message context

#### Scenario: Restore tracking is deduped
- **WHEN** the same history restore failure is observed repeatedly for the same loaded document/revision during one app session
- **THEN** the system SHALL avoid sending duplicate telemetry records for the same restore failure

