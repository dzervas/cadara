## ADDED Requirements

### Requirement: Developer-generated debug artifacts SHALL include session trace data when available
The system SHALL include structured debug-session trace data in developer-generated debug artifacts when the dev debug platform has captured that data and the artifact payload policy allows it.

#### Scenario: Debug session trace is available
- **WHEN** a developer generates a debug artifact after the dev debug platform has captured recent runtime trace entries
- **THEN** the artifact includes the bounded trace data or a bounded reference to it
- **AND** the trace data is labeled as development-only debugging context

#### Scenario: Trace data is unavailable or omitted
- **WHEN** no runtime trace data is available or the trace exceeds the artifact's payload policy
- **THEN** the artifact marks the trace section as unavailable or omitted
- **AND** the rest of the bug-report artifact remains valid
