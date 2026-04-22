## MODIFIED Requirements

### Requirement: Reconstruction settings SHALL be durable provenance
Accepted baked geometry assets SHALL record the reconstruction settings used to produce them, including unification tolerances and unification diagnostics.

#### Scenario: Save reconstructed import
- **WHEN** the user commits a reconstructed mesh import
- **THEN** the baked asset provenance records the algorithm id, algorithm version, tolerance settings, quality preset, result classification, unification linear tolerance, and unification angular tolerance
- **AND** restore uses the baked asset without rerunning reconstruction from the discarded source mesh

#### Scenario: Provenance includes unification metrics
- **WHEN** a reconstructed mesh import is committed
- **THEN** the baked asset provenance includes face count before unification, face count after unification, and merged surface type counts

## ADDED Requirements

### Requirement: Reconstruction settings SHALL include unification tolerance overrides
The mesh reconstruction settings type SHALL include optional unification linear tolerance and unification angular tolerance fields that override the defaults when present.

#### Scenario: Default unification tolerances used
- **WHEN** reconstruction settings do not specify unification tolerance overrides
- **THEN** the unification pass uses the default linear tolerance of 0.01 and angular tolerance of 0.01 radians

#### Scenario: Overridden unification tolerances used
- **WHEN** reconstruction settings specify custom unification tolerances
- **THEN** the unification pass uses the specified values instead of defaults
