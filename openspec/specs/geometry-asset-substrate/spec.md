# geometry-asset-substrate Specification

## Purpose
TBD - created by archiving change add-geometry-asset-substrate. Update Purpose after archive.

## Requirements
### Requirement: Authored documents SHALL reference immutable geometry assets
The system SHALL represent retained imported geometry as authored document data that can be validated and supplied to the modeling kernel for rebuild. STEP/STP files SHALL be translated to kernel-neutral Cadara B-rep JSON before persistence.

#### Scenario: Manifest references translated STEP geometry
- **WHEN** an authored document contains STEP-backed imported bodies
- **THEN** the document includes stable records with source provenance, content hash, byte length or equivalent validation metadata, format, media type, and JSON-resident Cadara B-rep data
- **AND** original STEP text or bytes are not stored inside the single authored document JSON object
- **AND** the Cadara B-rep data stores explicit topology and geometry records rather than a kernel-native serialized shape string

#### Scenario: Reject non-STEP retained geometry source
- **WHEN** an authored document attempts to retain STL, 3MF, OBJ, or arbitrary generated geometry bytes as an external geometry asset
- **THEN** contract validation rejects the document or reports a structured diagnostic
- **AND** the data is not treated as a packageable geometry blob

### Requirement: Geometry assets SHALL be validated before restore
The system SHALL validate translated kernel-neutral Cadara B-rep data and any persisted structured baked mesh geometry before using it to rebuild modeled bodies.

#### Scenario: Translated B-rep data is corrupt
- **WHEN** a restore attempts to use translated Cadara B-rep data whose hash, byte length, or equivalent validation metadata does not match the authored document
- **THEN** restore reports a structured geometry asset diagnostic
- **AND** the affected imported geometry feature is not silently replaced by empty geometry

#### Scenario: Prepared STEP commit validates translated B-rep without pre-commit kernel restore
- **WHEN** the workbench commits a prepared STEP import whose transient bake has produced Cadara B-rep JSON
- **THEN** the document is validated for authored-document structure, embedded geometry data, content hash, byte length, and selected-solid references before persistence
- **AND** the commit does not require a full OpenCascade restore of the translated B-rep before the repository write completes
- **AND** the active modeling adapter is handed the persisted authored document after the repository write so later snapshot refresh can materialize geometry separately

### Requirement: Translated Cadara B-rep SHALL support non-blocking presentation before full OCC materialization
The system SHALL allow persisted translated Cadara B-rep geometry to produce a visible imported-body presentation path before full OCC materialization completes.

#### Scenario: Persisted translated B-rep can render without immediate OCC restore
- **WHEN** a prepared STEP import has been baked, structurally validated, and persisted as Cadara B-rep JSON
- **THEN** the workbench can build a faceted presentation of the imported body directly from the persisted topology triangles
- **AND** the imported body becomes visible without waiting for a full Cadara-B-rep-to-OCC restore bridge to complete

#### Scenario: OCC materialization failure does not erase persisted imported geometry
- **WHEN** a persisted translated Cadara B-rep import later fails during OCC materialization
- **THEN** the authored document remains valid and persisted
- **AND** the imported body remains available through the persisted faceted presentation path
- **AND** the feature surfaces a structured materialization diagnostic rather than silently disappearing

### Requirement: Translated Cadara B-rep materialization SHALL be observable and bounded
The system SHALL expose explicit diagnostics or telemetry-ready timing for long-running translated Cadara B-rep restore stages so import completion does not remain indefinitely pending.

#### Scenario: Restore instrumentation captures materialization stages
- **WHEN** the modeling runtime materializes persisted translated Cadara B-rep geometry
- **THEN** the system records or reports timing for bridge-payload generation, OCC read/restore, solid construction, tracked-body setup, topology naming, and snapshot/render generation
- **AND** diagnostics can distinguish structural asset validation from post-persist OCC materialization cost

#### Scenario: Materialization exceeds bounded completion behavior
- **WHEN** translated Cadara B-rep materialization does not finish within the system's bounded completion behavior for the import flow
- **THEN** the workbench exits the import-progress state instead of waiting forever
- **AND** the feature reports that richer OCC materialization is pending, degraded, or failed
- **AND** the persisted authored document is not rolled back

#### Scenario: Structured baked mesh data is invalid
- **WHEN** a restore attempts to use persisted baked mesh JSON whose structure, hash, or validation metadata is invalid
- **THEN** restore reports a structured geometry diagnostic
- **AND** the affected baked geometry feature is not silently replaced by empty geometry

### Requirement: Derived geometry data SHALL remain transient
The system SHALL NOT persist derived render exports, OCC runtime objects, topology maps, tessellation buffers, viewport picking records, source mesh files, or standalone baked mesh blob payloads as geometry assets.

#### Scenario: Persist document after body rebuild
- **WHEN** the OCC runtime has rebuilt and tessellated geometry-backed bodies
- **THEN** persisted authored data includes only authored records, JSON-resident translated Cadara B-rep data, and any structured baked mesh geometry records
- **AND** render records and topology maps are regenerated on restore

### Requirement: STEP assets SHALL NOT retain original source bytes
The geometry persistence substrate SHALL persist translated Cadara B-rep geometry for STEP import features and SHALL NOT retain original STEP source text or bytes.

#### Scenario: Save STEP-backed document
- **WHEN** a document contains a STEP import feature
- **THEN** the single JSON saved payload includes translated Cadara B-rep geometry referenced by that feature
- **AND** reopening the payload does not require the user to select the original STEP file again
- **AND** the payload does not include the original STEP source text or bytes
- **AND** the payload does not include OpenCascade ASCII BRep, kernel-native BRep serializations, or opaque geometry strings

### Requirement: Multi-file STEP imports SHALL persist selected translated bodies
The geometry persistence substrate SHALL translate accepted multi-file STEP imports into selected Cadara B-rep bodies and SHALL NOT store the root or referenced STEP source files.

#### Scenario: Save document with multi-file STEP import
- **WHEN** a document contains a multi-file STEP import feature
- **THEN** the authored JSON contains translated Cadara B-rep body records for selected imported solids
- **AND** the saved `.cadara` payload is one JSON object that does not contain root or referenced STEP source content

#### Scenario: Reopen document with multi-file STEP import
- **WHEN** a saved JSON `.cadara` document containing a multi-file STEP import is opened in a fresh browser profile
- **THEN** the modeling runtime can rebuild the imported bodies without access to the original local STEP files
- **AND** missing or corrupt JSON-resident Cadara B-rep payloads are reported as structured geometry asset diagnostics

#### Scenario: Unselected referenced solids are not required
- **WHEN** a referenced STEP source file contributes no user-selected solids and is not needed to rebuild selected solids
- **THEN** the import does not need to retain that source file as owned document data for the feature
- **AND** save/open still rebuilds all selected imported bodies

### Requirement: STEP import provenance SHALL preserve source names
Translated STEP import records SHALL preserve enough source-name metadata to explain where the Cadara B-rep geometry came from without retaining source bytes.

#### Scenario: Asset records preserve referenced document names
- **WHEN** the workbench commits a multi-file STEP import
- **THEN** the translated geometry record stores the selected local root file name and source document name as provenance
- **AND** rebuild uses the translated Cadara B-rep data directly

#### Scenario: Duplicate referenced names are ambiguous
- **WHEN** selected STEP files produce ambiguous matches for the same referenced STEP document name
- **THEN** the import review reports a structured ambiguity diagnostic
- **AND** no asset mapping is committed until the ambiguity is resolved
