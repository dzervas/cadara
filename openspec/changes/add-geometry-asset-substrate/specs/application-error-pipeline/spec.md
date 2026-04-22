## ADDED Requirements

### Requirement: Diagnostics SHALL summarize geometry asset failures without attaching large blobs
The application error pipeline SHALL report geometry asset availability, validation, and restore failures without embedding raw asset bytes in telemetry or bug-report payloads.

#### Scenario: Bug report for missing geometry asset
- **WHEN** the active document has a missing or corrupt geometry asset diagnostic
- **THEN** bug-report and telemetry context includes asset id, format, byte length, hash prefix, owner feature target, and diagnostic code
- **AND** raw STEP, baked geometry, STL, 3MF, or triangle payload bytes are omitted
