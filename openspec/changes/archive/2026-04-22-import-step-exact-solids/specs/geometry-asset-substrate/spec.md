## ADDED Requirements

### Requirement: STEP assets SHALL retain original source bytes
The geometry asset substrate SHALL retain original STEP bytes as immutable source assets for exact solid import features.

#### Scenario: Save STEP-backed document
- **WHEN** a document contains a STEP import feature
- **THEN** the self-contained saved payload includes the exact STEP bytes referenced by that feature
- **AND** reopening the payload does not require the user to select the original STEP file again
