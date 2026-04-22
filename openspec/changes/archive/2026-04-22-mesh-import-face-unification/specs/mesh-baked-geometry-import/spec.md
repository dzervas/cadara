## MODIFIED Requirements

### Requirement: Mesh imports SHALL bake durable geometry before commit
The system SHALL commit a mesh import only after the initial basic conversion path produces a valid internal geometry asset. After conversion, the kernel SHALL apply bounded surface domain unification to recover analytical faces before tracking the solid when the import is eligible for same-domain merging.

#### Scenario: Conversion succeeds
- **WHEN** transient mesh conversion produces accepted baked geometry
- **THEN** the authored document records a mesh import feature referencing the baked asset
- **AND** restore uses the baked asset rather than the original mesh source
- **AND** eligible restored solids undergo bounded surface domain unification to merge tessellation triangles into analytical faces

#### Scenario: Conversion fails
- **WHEN** transient basic mesh conversion cannot produce acceptable durable geometry
- **THEN** the import is rejected with structured diagnostics
- **AND** no persistent mesh body or partial baked feature is committed
