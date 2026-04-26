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

### Requirement: STEP assets SHALL retain original source bytes
The geometry asset substrate SHALL retain original STEP bytes as immutable source assets for exact solid import features.

#### Scenario: Save STEP-backed document
- **WHEN** a document contains a STEP import feature
- **THEN** the self-contained saved payload includes the exact STEP bytes referenced by that feature
- **AND** reopening the payload does not require the user to select the original STEP file again

### Requirement: Baked mesh results SHALL be generated geometry assets
The geometry asset substrate SHALL store accepted mesh import results as generated immutable geometry assets, not as retained source mesh assets.

#### Scenario: Mesh import produces baked asset
- **WHEN** an STL or 3MF import commits
- **THEN** the asset manifest records a generated baked geometry asset with reconstruction provenance
- **AND** the manifest records that the original mesh source is not stored

### Requirement: Baked geometry assets SHALL record reconstruction quality metadata
Generated baked geometry asset records SHALL include reconstruction quality metadata when they originate from mesh conversion.

#### Scenario: Asset originated from mesh reconstruction
- **WHEN** a baked asset is generated from STL or 3MF triangles
- **THEN** the asset manifest records result classification, algorithm id, algorithm version, settings summary, and source hash
- **AND** the manifest still indicates that source mesh bytes are not stored

### Requirement: Multi-file STEP imports SHALL retain every required source file
The geometry asset substrate SHALL store the root STEP source file and every accepted referenced STEP source file needed to rebuild a multi-file STEP import.

#### Scenario: Save document with multi-file STEP import
- **WHEN** a document contains a multi-file STEP import feature
- **THEN** the asset manifest contains immutable geometry asset records for the root STEP file and referenced STEP files required by that feature
- **AND** the saved `.cadara` package contains the exact bytes for every referenced asset

#### Scenario: Reopen document with multi-file STEP import
- **WHEN** a saved `.cadara` package containing a multi-file STEP import is opened in a fresh browser profile
- **THEN** the modeling runtime can rebuild the imported bodies without access to the original local STEP files
- **AND** missing package asset bytes are reported as structured geometry asset diagnostics

#### Scenario: Unselected referenced solids are not required
- **WHEN** a referenced STEP source file contributes no user-selected solids and is not needed to rebuild selected solids
- **THEN** the import does not need to retain that source file as an owned geometry asset for the feature
- **AND** save/open still rebuilds all selected imported bodies

### Requirement: Multi-file STEP asset provenance SHALL preserve source names
Geometry asset records used by multi-file STEP imports SHALL preserve enough source-name metadata to resolve STEP document references during rebuild.

#### Scenario: Asset records preserve referenced document names
- **WHEN** the workbench commits a multi-file STEP import
- **THEN** each retained STEP asset records the selected local file name and the STEP document reference name it satisfies
- **AND** rebuild can map root document references to packaged asset bytes deterministically

#### Scenario: Duplicate referenced names are ambiguous
- **WHEN** selected STEP files produce ambiguous matches for the same referenced STEP document name
- **THEN** the import review reports a structured ambiguity diagnostic
- **AND** no asset mapping is committed until the ambiguity is resolved

