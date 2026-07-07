## ADDED Requirements

### Requirement: Baked-tier plans SHALL materialize ground-truth geometry
When a studio plan contains baked-tier features, the provider SHALL bake the bundle's ground-truth tessellation through `bakeGeometry` and emit a `bakedBody` feature action so the imported document contains the correct final geometry, while degraded source features remain listed with their reason codes.

#### Scenario: Complex model imports with visible geometry
- **WHEN** a bundle whose plan requires a studio bake is imported on a platform with baking support
- **THEN** the committed document contains a baked body matching the captured final geometry
- **AND** parametric-tier features remain live alongside it
- **AND** the `onshape-bake-unavailable` diagnostic is not emitted

#### Scenario: Baking capability absent
- **WHEN** the platform cannot bake the available ground-truth formats
- **THEN** the provider falls back to the previous behavior: suppressed features plus an explicit bake-unavailable diagnostic

#### Scenario: Bake provenance is recorded
- **WHEN** a baked body is emitted
- **THEN** its label and provenance identify the source Onshape studio and the feature span it stands in for
