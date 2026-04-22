# step-exact-solid-import Specification

## Purpose
Defines STEP import as exact solid geometry backed by retained source bytes and rebuilt through OCC.
## Requirements
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

### Requirement: STEP external-reference assemblies SHALL import referenced exact solids
The modeling runtime SHALL allow a STEP import feature to resolve a root STEP assembly file with selected referenced STEP source files and import supported solids from the resolved assembly.

#### Scenario: Import resolved external-reference assembly
- **WHEN** a STEP import references a root assembly file and all required referenced STEP part files
- **THEN** OCC reads the root file and referenced files together
- **AND** the snapshot contains the selected imported exact bodies with selectable body, face, edge, and vertex targets

#### Scenario: Referenced STEP file is missing
- **WHEN** a STEP import references an external STEP file that is not present in the document assets
- **THEN** the import is rejected with a structured diagnostic naming the missing referenced file
- **AND** no partial bodies are committed for that import feature

#### Scenario: Referenced STEP file is unreadable
- **WHEN** a referenced STEP source file cannot be read by OCC during import or rebuild
- **THEN** the import is rejected with a structured diagnostic naming the unreadable referenced file
- **AND** no partial bodies are committed for that import feature

### Requirement: STEP import SHALL persist selected solid intent
The STEP import feature SHALL record which discovered solids the user accepted so rebuild imports only those solids.

#### Scenario: User selects a subset of discovered solids
- **WHEN** the user accepts a STEP import review with only some supported solids selected
- **THEN** the authored import feature records deterministic selection keys for the accepted solids
- **AND** rebuild produces document bodies only for the accepted solid keys

#### Scenario: Selected solid key is missing on rebuild
- **WHEN** a saved multi-file STEP import rebuild cannot find a previously accepted solid key
- **THEN** the import reports a structured stale-selection diagnostic
- **AND** the feature does not silently replace the missing selected body with another discovered solid

#### Scenario: User selects no solids
- **WHEN** the user attempts to commit a STEP import review with no supported solids selected
- **THEN** the import is blocked before feature commit
- **AND** the user receives a visible diagnostic explaining that at least one solid must be selected

### Requirement: STEP import review SHALL discover supported solids before commit
The modeling service SHALL provide a STEP import review preparation step that reads selected STEP files and returns importable solid rows without committing authored history.

#### Scenario: Prepare review for monolithic STEP file
- **WHEN** the user selects a single STEP file containing embedded supported solids
- **THEN** the review preparation returns one row per supported solid
- **AND** the existing single-file import behavior remains available when all supported solids are accepted

#### Scenario: Prepare review for external-reference assembly
- **WHEN** the user selects a root STEP assembly and referenced sibling STEP files
- **THEN** the review preparation resolves referenced documents by selected file name
- **AND** the review returns one row per supported solid discovered from the resolved assembly

#### Scenario: Prepare review with missing external references
- **WHEN** the root STEP assembly references sibling STEP files that were not selected
- **THEN** the review preparation returns diagnostics naming the missing references
- **AND** the review does not commit an import feature

