## ADDED Requirements

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
