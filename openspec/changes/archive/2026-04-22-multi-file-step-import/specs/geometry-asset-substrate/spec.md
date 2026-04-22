## ADDED Requirements

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
