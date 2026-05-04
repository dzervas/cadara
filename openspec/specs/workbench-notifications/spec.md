# workbench-notifications Specification

## Purpose
TBD - created by archiving change differentiate-notification-types. Update Purpose after archive.
## Requirements
### Requirement: Typed notification presentation
The system SHALL render workbench notifications with an explicit type of `info`, `warning`, or `error`, and each type SHALL be visually distinguishable through an icon, accent treatment, title styling, and border treatment while preserving the dense dark workbench shell.

#### Scenario: Informational notification renders
- **WHEN** an informational workbench notification is shown
- **THEN** it uses the information icon and workbench accent treatment
- **AND** it presents a clear title and human-readable message body
- **AND** it exposes non-interruptive status semantics to assistive technology

#### Scenario: Warning notification renders
- **WHEN** a warning workbench notification is shown
- **THEN** it uses a warning icon and warning semantic treatment
- **AND** it presents a clear title and human-readable message body
- **AND** it is distinguishable from informational and error notifications without relying on message text alone

#### Scenario: Error notification renders
- **WHEN** an error workbench notification is shown
- **THEN** it uses an error icon and danger semantic treatment
- **AND** it presents a clear title and human-readable message body
- **AND** it exposes alert semantics to assistive technology

### Requirement: Notification dismissal timing
The system SHALL apply type-specific notification dismissal behavior: `info` notifications MUST auto-dismiss after 5 seconds, `warning` notifications MUST auto-dismiss after 15 seconds, and `error` notifications MUST remain visible until manually dismissed unless a caller explicitly removes them.

#### Scenario: Informational notification expires
- **WHEN** an informational workbench notification is displayed for 5 seconds
- **THEN** the notification is dismissed automatically

#### Scenario: Warning notification expires
- **WHEN** a warning workbench notification is displayed for 15 seconds
- **THEN** the notification is dismissed automatically

#### Scenario: Error notification persists
- **WHEN** an error workbench notification is displayed for longer than 15 seconds
- **THEN** the notification remains visible
- **AND** the user can dismiss it manually

#### Scenario: Notification is manually dismissed
- **WHEN** the user activates a notification's dismiss control
- **THEN** the notification is removed immediately
- **AND** any pending auto-dismiss timer for that notification is cleared

### Requirement: Viewport-safe notification placement
The system SHALL place viewport-local workbench notifications so they do not cover the view cube, toolbar, or primary sketch controls on supported desktop and mobile viewport widths.

#### Scenario: View cube is reserved
- **WHEN** a viewport-local notification is displayed while the view cube is visible
- **THEN** the notification is offset away from the view cube
- **AND** it remains fully readable within the viewport bounds

#### Scenario: Multiple notification surfaces are visible
- **WHEN** more than one viewport-local notification surface is visible
- **THEN** the surfaces are vertically separated
- **AND** their text, action controls, and dismiss controls do not overlap

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

