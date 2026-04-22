## ADDED Requirements

### Requirement: OCC adapter SHALL restore STEP import features from assets
The OCC kernel adapter SHALL rebuild STEP import features from referenced geometry assets during authored document restore.

#### Scenario: Rebuild imported STEP body
- **WHEN** the authored history cursor includes a STEP import feature
- **THEN** the OCC adapter reads the referenced asset bytes in the worker/runtime rebuild path
- **AND** it registers produced bodies through the same topology tracking used by native solid features
