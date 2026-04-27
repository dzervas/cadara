# single-json-cadara-geometry Specification

## Purpose
TBD - created by archiving change single-json-cadara-geometry. Update Purpose after archive.

## Requirements
### Requirement: Cadara documents SHALL serialize as one JSON object
The `.cadara` format SHALL be a single serialized authored model document JSON object, not a ZIP archive, directory, manifest plus sidecar files, or sequence of byte blobs.

#### Scenario: Export document with retained geometry
- **WHEN** the user exports a document that contains retained geometry data
- **THEN** the export payload is one JSON object
- **AND** the payload can be parsed directly as authored document JSON without opening a ZIP archive

#### Scenario: Reject packaged cadara payload
- **WHEN** the user opens or imports a ZIP-backed `.cadara` package
- **THEN** the system rejects the payload as unsupported by the current document contract
- **AND** no backwards-compatible package extraction path is used

### Requirement: STEP imports SHALL persist translated Cadara B-rep data
The system SHALL treat STEP/STP source content as transient import input and SHALL persist the translated Cadara B-rep geometry needed for rebuild inside the single authored document JSON object.

#### Scenario: Save STEP-backed document
- **WHEN** a document contains a STEP import feature
- **THEN** the exported `.cadara` JSON contains translated Cadara B-rep data required by the feature
- **AND** reopening the JSON document can rebuild the STEP import without selecting the original local STEP file
- **AND** the JSON does not contain the original STEP source text or bytes
- **AND** the persisted geometry does not contain kernel-specific serialized B-rep strings or kernel-specific field names

#### Scenario: Save multi-file STEP-backed document
- **WHEN** a document contains a multi-file STEP import with retained referenced source files
- **THEN** the exported `.cadara` JSON contains the selected translated Cadara B-rep bodies inside the JSON object
- **AND** rebuild does not require resolving original root or referenced STEP documents

#### Scenario: Persist kernel-neutral Cadara B-rep
- **WHEN** a STEP import is saved
- **THEN** each persisted Cadara B-rep body is represented with explicit JSON topology and geometry records such as solids, shells, faces, loops, coedges, edges, vertices, and tessellated fallback triangles
- **AND** the persisted authored JSON does not contain OpenCascade ASCII BRep, kernel-native binary data, base64 geometry payloads, or opaque geometry strings

### Requirement: Accepted STEP imports SHALL complete end to end without indefinite pending restore
The system SHALL let an accepted STEP import finish its user-visible flow after persistence and initial visible presentation are ready, even if richer OCC materialization continues afterward.

#### Scenario: Full import path completes for large manifold STEP import
- **WHEN** the user accepts a large manifold STEP import that bakes successfully into translated Cadara B-rep geometry
- **THEN** the authored document persists that translated geometry
- **AND** the imported body becomes visible without requiring the original STEP files
- **AND** the workbench import progress completes instead of remaining pending forever while OCC restore continues or degrades separately

### Requirement: Baked mesh geometry SHALL be structured JSON when persisted
Any persisted baked mesh geometry SHALL be represented as structured, format-neutral authored JSON data rather than as filetype-specific source bytes, package entries, or separately stored geometry blob bytes.

#### Scenario: Persist baked mesh geometry
- **WHEN** the system persists mesh-derived geometry
- **THEN** the authored document stores structured geometry data such as vertices, indices, topology/reconstruction provenance, and neutral placement metadata inside the JSON object
- **AND** the payload is not encoded as STL, 3MF, OBJ, or a standalone `baked-mesh` file blob

#### Scenario: Mesh source remains transient
- **WHEN** the user imports an STL or 3MF mesh file
- **THEN** the original mesh source bytes are discarded after transient parsing/review
- **AND** the saved `.cadara` JSON does not contain the source file bytes
