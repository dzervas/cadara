# mesh-baked-geometry-import Specification

## Purpose
TBD - created by archiving change single-json-cadara-geometry. Update Purpose after archive.

## Requirements
### Requirement: Mesh imports SHALL discard source files after baking
The system SHALL import STL and 3MF mesh files by transiently parsing the source and SHALL NOT persist the source mesh bytes or a standalone baked mesh blob in `.cadara`.

#### Scenario: Accept mesh source-discard warning
- **WHEN** the user imports an STL or 3MF file
- **THEN** the import flow warns that the source mesh will not be saved in the document
- **AND** the import cannot commit until the user accepts that warning

#### Scenario: Save accepted mesh import
- **WHEN** a mesh import successfully produces persisted baked geometry
- **THEN** the saved document contains structured, format-neutral baked geometry data and import provenance inside the authored JSON object
- **AND** the saved document does not contain original STL bytes, original 3MF bytes, raw source file bytes, standalone baked mesh blob assets, or source mesh render records

### Requirement: Mesh imports SHALL bake durable geometry before commit
The system SHALL commit a mesh import only after the conversion path produces valid internal geometry that can be represented in the single authored JSON document. After conversion, the kernel SHALL apply bounded surface domain unification to recover analytical faces before tracking the solid when the import is eligible for same-domain merging.

#### Scenario: Conversion succeeds
- **WHEN** transient mesh conversion produces accepted baked geometry
- **THEN** the authored document records a mesh import feature referencing structured baked geometry data inside the JSON document
- **AND** restore uses that structured authored geometry data rather than the original mesh source or a standalone `baked-mesh` asset blob
- **AND** eligible restored solids undergo bounded surface domain unification to merge tessellation triangles into analytical faces

#### Scenario: Conversion fails
- **WHEN** transient basic mesh conversion cannot produce acceptable durable geometry
- **THEN** the import is rejected with structured diagnostics
- **AND** no persistent mesh body or partial baked feature is committed

### Requirement: Mesh import SHALL show reconstruction quality before commit
The mesh import flow SHALL show reconstruction quality, fallback classification, and a visible “Probably Broken” status before committing a baked geometry result.

#### Scenario: Faceted fallback is available
- **WHEN** mesh conversion can only produce faceted baked geometry
- **THEN** the user sees a warning that the saved result will be faceted and the source mesh will not be retained
- **AND** the user must accept the result before the import feature is committed

#### Scenario: Mesh import modal warns about broken state
- **WHEN** the STL or 3MF import review modal is open
- **THEN** the modal title area shows a “Probably Broken” chip
- **AND** the chip remains visible before the user commits or cancels the import
