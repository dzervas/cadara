## ADDED Requirements

### Requirement: Local file sync SHALL write self-contained ZIP packages
Local file sync SHALL write geometry asset bytes together with the normalized authored document in a ZIP-backed `.cadara` package when a bound document references assets.

#### Scenario: Autosync document with assets
- **WHEN** autosync writes a bound local document that references geometry assets
- **THEN** the written `.cadara` package contains the authored document JSON and all referenced asset bytes
- **AND** the payload does not include browser-local file handles or local sync binding metadata

### Requirement: Local open SHALL restore packaged geometry assets
Local file open SHALL load geometry assets from the selected self-contained ZIP-backed `.cadara` package into repository asset storage.

#### Scenario: Open saved document in new session
- **WHEN** the user opens a `.cadara` package containing geometry assets
- **THEN** the document sync worker restores the authored document and stores all included geometry blobs
- **AND** modeling restore can rebuild geometry-backed features without asking for the original import files
