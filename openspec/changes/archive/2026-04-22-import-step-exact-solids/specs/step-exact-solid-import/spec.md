## ADDED Requirements

### Requirement: STEP files SHALL import as exact solid assets
The system SHALL allow users to import `.step` or `.stp` files as exact solid geometry backed by retained STEP asset bytes.

#### Scenario: Import valid STEP file
- **WHEN** the user selects a valid STEP file and accepts import settings
- **THEN** the system stores the original STEP bytes as an immutable geometry asset
- **AND** the authored document records an import feature referencing that asset and the resolved import settings

### Requirement: Imported STEP bodies SHALL rebuild through OCC
The modeling runtime SHALL rebuild STEP import features by reading the referenced STEP asset through OCC and extracting exact solid bodies.

#### Scenario: Restore document with STEP import
- **WHEN** a saved document containing a STEP import feature is restored
- **THEN** OCC reads the retained STEP asset bytes
- **AND** the snapshot contains imported exact bodies with selectable body, face, edge, and vertex targets

#### Scenario: Restore STEP file with multiple supported solids
- **WHEN** a saved STEP import feature references a file containing multiple supported solid shapes
- **THEN** OCC rebuild imports each supported solid as a separate document body
- **AND** body labels are assigned deterministically from STEP names when available and import order when names are unavailable

### Requirement: STEP import SHALL report unsupported files
The system SHALL report structured diagnostics when a STEP file cannot be read or cannot produce supported exact solid bodies.

#### Scenario: STEP file has no supported solid
- **WHEN** the user imports a STEP file that OCC reads but cannot convert into supported solid bodies
- **THEN** the import is rejected with a diagnostic explaining the unsupported case
- **AND** no partial feature with missing geometry is committed

#### Scenario: STEP file mixes supported solids and unsupported non-solid content
- **WHEN** the user imports a STEP file containing supported solid bodies and unsupported non-solid geometry
- **THEN** the import commits the supported solids only when no accepted body would depend on the unsupported content
- **AND** the import reports a diagnostic summarizing the skipped unsupported content
