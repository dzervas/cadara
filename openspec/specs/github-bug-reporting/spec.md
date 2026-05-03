# github-bug-reporting Specification

## Purpose
TBD - created by archiving change add-github-bug-reporting. Update Purpose after archive.
## Requirements
### Requirement: Workbench SHALL expose a GitHub bug-report action
The system SHALL provide a user-facing workbench action that starts a GitHub bug report for the current Cadara session without requiring a backend or GitHub write token.

#### Scenario: User starts a bug report
- **WHEN** the user activates the report-bug action from the workbench shell
- **THEN** the system opens the Cadara GitHub new-issue page with the bug-report issue form selected
- **AND** the opened issue form contains prefilled fields for build, browser, editor, diagnostics, and debug-payload status

#### Scenario: Report action follows workbench chrome conventions
- **WHEN** the report-bug action renders in the workbench shell
- **THEN** it uses a compact icon-only control with an accessible label and tooltip
- **AND** it uses the existing Mantine-backed dark workbench styling conventions and local icon assets

### Requirement: GitHub bug issue form SHALL collect human reproduction details
The repository SHALL define a GitHub issue form template for bug reports that prioritizes human-readable reproduction information before machine-generated debug data.

#### Scenario: Reporter opens the bug form
- **WHEN** the GitHub bug issue form loads
- **THEN** it presents fields for summary, steps to reproduce, actual behavior, expected behavior, reproducibility or frequency, screenshots or recordings, and additional context
- **AND** it presents separate fields for environment metadata, diagnostics, and debug payload data

#### Scenario: Reporter can attach generated artifacts
- **WHEN** generated debug data is too large to inline
- **THEN** the issue form provides an upload-capable location or instruction for attaching the downloaded debug artifact
- **AND** the prefilled report text identifies the expected artifact filename or payload status

### Requirement: Bug report payload SHALL prioritize reproducible Cadara inputs
The system SHALL generate a structured bug-report payload from the active app context that prioritizes durable reproduction inputs and compact diagnostics over complete transient UI state.

#### Scenario: Document snapshot is available
- **WHEN** the user starts a bug report while an active document snapshot is loaded
- **THEN** the payload includes document id, revision id, schema version, document counts, and an authored model document representation when it fits the payload policy
- **AND** the authored document excludes render exports, presentation tree rows, selection catalogs, preview geometry, OpenCascade runtime objects, and other derived presentation state

#### Scenario: Operation history is available
- **WHEN** versioned modeling operation history is available for the active document
- **THEN** the payload includes operation-history metadata and recent operation entries when they fit the payload policy
- **AND** the payload marks operation history as unavailable or omitted when it cannot be read, is invalid, or exceeds the inline threshold

#### Scenario: Active workflow is transient
- **WHEN** the user starts a bug report while editing an uncommitted sketch, feature form, preview, selection command, or reference picker
- **THEN** the payload includes compact transient editor context relevant to that workflow
- **AND** the payload does not serialize unrelated full React component state or provider internals

#### Scenario: Diagnostics and errors exist
- **WHEN** the active document or app error context contains diagnostics, recent errors, or recent warnings
- **THEN** the payload includes stable diagnostic codes, severities, messages, targets, request ids, and stack traces when available
- **AND** the report generation does not swallow or mask the original error context when a field cannot be serialized

### Requirement: Environment metadata SHALL be collected with browser-safe fallbacks
The system SHALL collect enough environment metadata to distinguish browser, build, rendering, and runtime conditions without requiring unavailable browser APIs.

#### Scenario: Browser supports modern client hints
- **WHEN** `navigator.userAgentData` is available
- **THEN** the payload includes supported user-agent client hint metadata
- **AND** it still includes a classic user-agent fallback string

#### Scenario: Browser metadata is limited
- **WHEN** a browser does not expose optional client hints, platform data, WebGL information, or visual capture APIs
- **THEN** the payload records the unavailable fields explicitly or omits them
- **AND** the report action still opens the GitHub issue form

#### Scenario: Viewport context is captured
- **WHEN** the report payload is generated in a browser window
- **THEN** it includes viewport size, device pixel ratio, route path/search context, and best-effort WebGL vendor/renderer information

### Requirement: Inline debug data SHALL remain readable and bounded
The system SHALL inline only bounded debug data into the GitHub issue form and SHALL hide bulky inline sections behind Markdown disclosure blocks.

#### Scenario: Debug section fits inline threshold
- **WHEN** a debug JSON section is small enough to include in the issue
- **THEN** the generated Markdown wraps the section in `<details>` with a descriptive `<summary>`
- **AND** the machine-readable content appears inside a fenced code block

#### Scenario: Debug section exceeds inline threshold
- **WHEN** a document, operation-history, console, screenshot, or combined debug section exceeds the inline threshold
- **THEN** the issue prefill omits the bulky content and replaces it with a clear omitted-too-large marker
- **AND** the marker tells the reporter to attach the generated debug artifact

#### Scenario: Issue URL is generated
- **WHEN** the app builds the GitHub issue URL
- **THEN** the URL contains only bounded prefill fields and does not encode the complete document or full debug artifact as query parameters

### Requirement: Large debug payloads SHALL be available as a user-controlled artifact
The system SHALL generate a downloadable debug artifact when high-value reproduction data cannot be safely inlined.

#### Scenario: Large payload fallback is needed
- **WHEN** one or more high-value debug sections exceed the inline threshold
- **THEN** the system downloads or offers a debug artifact containing the compact report and omitted full sections
- **AND** the artifact uses a deterministic, timestamped filename that the issue prefill references

#### Scenario: Artifact generation fails
- **WHEN** the browser cannot create the debug artifact
- **THEN** the system still opens the GitHub issue form with the compact inline report
- **AND** the inline report marks the artifact as unavailable with the failure reason when available

#### Scenario: User privacy remains explicit
- **WHEN** a debug artifact contains authored document or operation-history data
- **THEN** the data is generated only after the user activates the report-bug action
- **AND** the app does not automatically upload the artifact or submit it to GitHub

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

