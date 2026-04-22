# geometry-asset-substrate Specification

## Purpose
TBD - created by archiving change add-geometry-asset-substrate. Update Purpose after archive.
## Requirements
### Requirement: Authored documents SHALL reference immutable geometry assets
The system SHALL represent imported or generated geometry bytes as immutable content-addressed assets referenced by the authored model document.

#### Scenario: Asset manifest references geometry bytes
- **WHEN** an authored document contains geometry-backed imported or baked bodies
- **THEN** the document includes asset manifest records with stable asset id, content hash, byte length, format, media type, and provenance
- **AND** raw geometry bytes are not stored directly in feature definitions, render records, or OCC runtime state fields

### Requirement: Geometry assets SHALL be validated before restore
The system SHALL validate referenced geometry assets before using them to rebuild modeled bodies.

#### Scenario: Referenced asset bytes are corrupt
- **WHEN** a restore attempts to use asset bytes whose hash or byte length does not match the authored manifest
- **THEN** restore reports a structured geometry asset diagnostic
- **AND** the affected imported or baked geometry feature is not silently replaced by empty geometry

### Requirement: Saved documents SHALL be self-contained ZIP packages
The system SHALL save authored documents with all referenced geometry asset bytes in one portable ZIP-backed `.cadara` payload.

#### Scenario: Save document with geometry assets
- **WHEN** the user saves or exports a document that references geometry assets
- **THEN** the saved `.cadara` package contains the normalized authored document JSON and every referenced immutable geometry blob as package members
- **AND** reopening the payload in a fresh browser profile can rebuild the document without access to the original source files

### Requirement: Derived geometry data SHALL remain transient
The system SHALL NOT persist derived render exports, OCC runtime objects, topology maps, tessellation buffers, or viewport picking records as geometry assets.

#### Scenario: Persist document after body rebuild
- **WHEN** the OCC runtime has rebuilt and tessellated geometry-backed bodies
- **THEN** persisted authored data includes only authored records and immutable source or baked geometry assets
- **AND** render records and topology maps are regenerated on restore

### Requirement: STEP assets SHALL retain original source bytes
The geometry asset substrate SHALL retain original STEP bytes as immutable source assets for exact solid import features.

#### Scenario: Save STEP-backed document
- **WHEN** a document contains a STEP import feature
- **THEN** the self-contained saved payload includes the exact STEP bytes referenced by that feature
- **AND** reopening the payload does not require the user to select the original STEP file again
