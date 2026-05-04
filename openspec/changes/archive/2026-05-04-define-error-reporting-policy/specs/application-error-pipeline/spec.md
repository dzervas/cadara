## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Workbench Action Failure Funnel
The system SHALL execute modeling-service-facing workbench actions through a shared helper that normalizes failures, applies explicit reporting policy, surfaces configured UI failure state, and returns a typed success or failure result to the caller.

#### Scenario: Action helper handles rejected promise
- **WHEN** a workbench action promise rejects because of an unexpected exception or infrastructure failure
- **THEN** the action helper SHALL normalize the rejection, report it through the central reporter, update the configured UI error surface, and return an error result

#### Scenario: Action helper handles rejected modeling result
- **WHEN** a modeling service response returns diagnostics with a non-accepted revision state for an expected CAD/domain rejection
- **THEN** the action helper SHALL map the first actionable diagnostic into the user-visible message while preserving all diagnostics in error context
- **AND** the action helper SHALL NOT report the rejection as a defect unless the caller explicitly classifies that operation as reportable
