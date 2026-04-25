## MODIFIED Requirements

### Requirement: Authored documents SHALL reference immutable geometry assets
The system SHALL represent retained exact geometry source content as authored document data that can be validated and supplied to the modeling kernel for rebuild. STEP/STP source content is the only retained imported geometry source supported by the persistence contract.

#### Scenario: Retained source manifest references STEP data
- **WHEN** an authored document contains STEP-backed imported bodies
- **THEN** the document includes stable records with source identity, content hash, byte length or equivalent validation metadata, format, media type, provenance, and JSON-resident source payload reference
- **AND** the retained STEP payload is stored inside the single authored document JSON object

#### Scenario: Reject non-STEP retained geometry source
- **WHEN** an authored document attempts to retain STL, 3MF, OBJ, or arbitrary generated geometry bytes as an external geometry asset
- **THEN** contract validation rejects the document or reports a structured diagnostic
- **AND** the data is not treated as a packageable geometry blob

### Requirement: Geometry assets SHALL be validated before restore
The system SHALL validate retained STEP source data and any persisted structured baked mesh geometry before using it to rebuild modeled bodies.

#### Scenario: Referenced asset bytes are corrupt
- **WHEN** a restore attempts to use retained STEP source data whose hash, byte length, or equivalent validation metadata does not match the authored document
- **THEN** restore reports a structured geometry asset diagnostic
- **AND** the affected imported geometry feature is not silently replaced by empty geometry

#### Scenario: Structured baked mesh data is invalid
- **WHEN** a restore attempts to use persisted baked mesh JSON whose structure, hash, or validation metadata is invalid
- **THEN** restore reports a structured geometry diagnostic
- **AND** the affected baked geometry feature is not silently replaced by empty geometry

### Requirement: Derived geometry data SHALL remain transient
The system SHALL NOT persist derived render exports, OCC runtime objects, topology maps, tessellation buffers, viewport picking records, source mesh files, or standalone baked mesh blob payloads as geometry assets.

#### Scenario: Persist document after body rebuild
- **WHEN** the OCC runtime has rebuilt and tessellated geometry-backed bodies
- **THEN** persisted authored data includes only authored records, JSON-resident retained STEP source data, and any structured baked mesh geometry records
- **AND** render records and topology maps are regenerated on restore

### Requirement: STEP assets SHALL retain original source bytes
The geometry persistence substrate SHALL retain original STEP bytes as JSON-resident source data for exact solid import features.

#### Scenario: Save STEP-backed document
- **WHEN** a document contains a STEP import feature
- **THEN** the single JSON saved payload includes the exact STEP content referenced by that feature in a Cadara-friendly JSON representation
- **AND** reopening the payload does not require the user to select the original STEP file again

### Requirement: Multi-file STEP imports SHALL retain every required source file
The geometry persistence substrate SHALL store the root STEP source file and every accepted referenced STEP source file needed to rebuild a multi-file STEP import inside the single authored document JSON object.

#### Scenario: Save document with multi-file STEP import
- **WHEN** a document contains a multi-file STEP import feature
- **THEN** the authored JSON contains retained source records for the root STEP file and referenced STEP files required by that feature
- **AND** the saved `.cadara` payload is one JSON object containing the exact content for every referenced STEP source

#### Scenario: Reopen document with multi-file STEP import
- **WHEN** a saved JSON `.cadara` document containing a multi-file STEP import is opened in a fresh browser profile
- **THEN** the modeling runtime can rebuild the imported bodies without access to the original local STEP files
- **AND** missing JSON-resident source payloads are reported as structured geometry asset diagnostics

#### Scenario: Unselected referenced solids are not required
- **WHEN** a referenced STEP source file contributes no user-selected solids and is not needed to rebuild selected solids
- **THEN** the import does not need to retain that source file as owned document data for the feature
- **AND** save/open still rebuilds all selected imported bodies

### Requirement: Multi-file STEP asset provenance SHALL preserve source names
Geometry source records used by multi-file STEP imports SHALL preserve enough source-name metadata to resolve STEP document references during rebuild.

#### Scenario: Asset records preserve referenced document names
- **WHEN** the workbench commits a multi-file STEP import
- **THEN** each retained STEP source record stores the selected local file name and the STEP document reference name it satisfies
- **AND** rebuild can map root document references to JSON-resident STEP source data deterministically

#### Scenario: Duplicate referenced names are ambiguous
- **WHEN** selected STEP files produce ambiguous matches for the same referenced STEP document name
- **THEN** the import review reports a structured ambiguity diagnostic
- **AND** no asset mapping is committed until the ambiguity is resolved

## REMOVED Requirements

### Requirement: Saved documents SHALL be self-contained ZIP packages
**Reason**: `.cadara` must be a single authored JSON object, and ZIP package handling preserved an unwanted sequence-of-files persistence model.
**Migration**: None. ZIP-backed `.cadara` packages are intentionally unsupported by this change.

### Requirement: Baked mesh results SHALL be generated geometry assets
**Reason**: Baked mesh data must not be persisted as a standalone generated geometry blob.
**Migration**: None. Existing documents that require packaged `baked-mesh` assets are intentionally unsupported.

### Requirement: Baked geometry assets SHALL record reconstruction quality metadata
**Reason**: Reconstruction quality metadata for mesh-derived geometry belongs in structured authored JSON records, not generated blob asset records.
**Migration**: None. Existing generated `baked-mesh` asset records are intentionally unsupported.
