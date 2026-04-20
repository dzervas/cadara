## MODIFIED Requirements

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
