## ADDED Requirements

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

### Requirement: Retained STEP source data SHALL be JSON document data
The system SHALL retain STEP/STP source content needed for exact import rebuilds inside the single authored document JSON object using a kernel-contract representation that can reproduce the source bytes for OCC.

#### Scenario: Save STEP-backed document
- **WHEN** a document contains a STEP import feature
- **THEN** the exported `.cadara` JSON contains the retained STEP source data required by the feature
- **AND** reopening the JSON document can rebuild the STEP import without selecting the original local STEP file

#### Scenario: Save multi-file STEP-backed document
- **WHEN** a document contains a multi-file STEP import with retained referenced source files
- **THEN** the exported `.cadara` JSON contains every required STEP source payload and reference name mapping inside the JSON object
- **AND** rebuild can resolve root and referenced STEP documents from the JSON document data

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
