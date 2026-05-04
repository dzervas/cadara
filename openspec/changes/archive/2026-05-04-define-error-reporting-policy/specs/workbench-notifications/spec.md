## ADDED Requirements

### Requirement: Notification Reporting Separation
The system SHALL keep workbench notification presentation separate from telemetry reporting policy.

#### Scenario: Error notification does not imply telemetry
- **WHEN** a workbench notification is rendered with type `error`
- **THEN** the notification SHALL use error presentation and accessibility semantics
- **AND** the notification SHALL NOT by itself send or imply a central error reporter event

#### Scenario: Reportable failure may also notify
- **WHEN** a reportable workbench failure affects the current user workflow
- **THEN** the application layer MAY show an error notification for the user-facing message
- **AND** the application layer SHALL send telemetry through the central error reporter separately from notification rendering
