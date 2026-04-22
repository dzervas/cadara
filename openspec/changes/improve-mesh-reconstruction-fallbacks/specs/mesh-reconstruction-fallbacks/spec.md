## ADDED Requirements

### Requirement: Reconstruction SHALL classify baked results
The mesh reconstruction pipeline SHALL classify each attempted import result as analytic, faceted fallback, rejected, or future mesh-body exception.

#### Scenario: Analytic recovery succeeds
- **WHEN** reconstruction confidently detects supported analytic surfaces from a transient mesh
- **THEN** the baked result is classified as analytic
- **AND** the asset provenance records the algorithm version, settings, source hash, and recovered surface summary

#### Scenario: Reconstruction cannot produce valid geometry
- **WHEN** reconstruction cannot produce valid analytic or acceptable faceted geometry
- **THEN** the import result is classified as rejected
- **AND** no persistent geometry feature is committed

### Requirement: Fallback policy SHALL prefer strict rejection before faceted geometry before mesh bodies
The system SHALL apply the fallback order strict rejection, then faceted baked geometry when acceptable, then persistent mesh body only as an explicit future exception.

#### Scenario: Analytic reconstruction is uncertain but faceted topology is valid
- **WHEN** analytic reconstruction confidence is too low and faceted baked topology satisfies quality and size limits
- **THEN** the system may offer a faceted baked geometry result
- **AND** the result is clearly classified as faceted fallback before commit

#### Scenario: Mesh body fallback would be required
- **WHEN** a mesh can only be represented by saving the original mesh or a persistent mesh body
- **THEN** the default import flow rejects the import
- **AND** diagnostics state that persistent mesh body fallback is not enabled

### Requirement: Reconstruction settings SHALL be durable provenance
Accepted baked geometry assets SHALL record the reconstruction settings used to produce them.

#### Scenario: Save reconstructed import
- **WHEN** the user commits a reconstructed mesh import
- **THEN** the baked asset provenance records the algorithm id, algorithm version, tolerance settings, quality preset, and result classification
- **AND** restore uses the baked asset without rerunning reconstruction from the discarded source mesh
