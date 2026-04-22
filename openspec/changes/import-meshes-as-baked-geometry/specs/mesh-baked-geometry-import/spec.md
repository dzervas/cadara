## ADDED Requirements

### Requirement: Mesh imports SHALL discard source files after baking
The system SHALL import STL and 3MF mesh files by transiently parsing the source and persisting only accepted baked geometry results.

#### Scenario: Accept mesh source-discard warning
- **WHEN** the user imports an STL or 3MF file
- **THEN** the import flow warns that the source mesh will not be saved in the document
- **AND** the import cannot commit until the user accepts that warning

#### Scenario: Save accepted mesh import
- **WHEN** a mesh import successfully produces baked geometry
- **THEN** the saved document contains the baked geometry asset and import provenance
- **AND** the saved document does not contain original STL bytes, original 3MF bytes, raw triangle arrays, or source mesh render records

### Requirement: Mesh imports SHALL bake durable geometry before commit
The system SHALL commit a mesh import only after the initial basic conversion path produces a valid internal geometry asset.

#### Scenario: Conversion succeeds
- **WHEN** transient mesh conversion produces accepted baked geometry
- **THEN** the authored document records a mesh import feature referencing the baked asset
- **AND** restore uses the baked asset rather than the original mesh source

#### Scenario: Conversion fails
- **WHEN** transient basic mesh conversion cannot produce acceptable durable geometry
- **THEN** the import is rejected with structured diagnostics
- **AND** no persistent mesh body or partial baked feature is committed

### Requirement: 3MF import SHALL be triangle-geometry only
The first 3MF import scope SHALL extract only triangle geometry needed for baked conversion.

#### Scenario: 3MF contains non-geometry metadata
- **WHEN** a 3MF file includes materials, colors, textures, build metadata, or manufacturing extensions
- **THEN** the importer ignores metadata that does not affect triangle geometry
- **AND** it rejects cases where unsupported metadata is required to interpret geometry correctly
