# geometry-asset-substrate Specification

## Purpose
TBD - created by archiving change add-geometry-asset-substrate. Update Purpose after archive.
## Requirements
### Requirement: Authored documents SHALL reference immutable geometry assets
The system SHALL represent imported or generated geometry bytes as immutable content-addressed assets referenced by the authored model document. Asset provenance records for imported assets SHALL optionally carry import binding metadata describing the external source origin, fingerprint, and refresh policy.

#### Scenario: Asset manifest references geometry bytes
- **WHEN** an authored document contains geometry-backed imported or baked bodies
- **THEN** the document includes asset manifest records with stable asset id, content hash, byte length, format, media type, and provenance
- **AND** raw geometry bytes are not stored directly in feature definitions, render records, or OCC runtime state fields

#### Scenario: Imported asset carries binding metadata
- **WHEN** a geometry asset is created through the import provider pipeline from a source that supports refresh
- **THEN** the asset's provenance record includes an optional `importBinding` field with the source origin kind, fingerprint, display path hint or URL, and refresh policy
- **AND** the binding metadata is persisted as part of the asset provenance in the authored document

#### Scenario: Imported asset without binding
- **WHEN** a geometry asset is created through the import provider pipeline from a one-shot source with no refresh support
- **THEN** the asset's provenance record has no `importBinding` field
- **AND** the asset is treated identically to any other imported asset for restore and validation purposes

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

