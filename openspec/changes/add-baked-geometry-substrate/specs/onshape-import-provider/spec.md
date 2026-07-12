## ADDED Requirements

### Requirement: Baked-tier plans SHALL materialize ground-truth geometry
When a studio plan contains baked-tier features, the provider SHALL bake the bundle's ground-truth tessellation through `bakeGeometry` and emit a `bakedBody` feature action so the imported document contains the correct final geometry, while degraded source features remain listed with their reason codes.

#### Scenario: Complex model imports with visible geometry
- **WHEN** a bundle whose plan requires a studio bake is imported on a platform with baking support
- **THEN** the committed document contains only the baked body set for the imported final studio geometry, rather than duplicate live parametric outputs
- **AND** parametric-tier features remain in history for editability and fidelity reporting
- **AND** the `onshape-bake-unavailable` diagnostic is not emitted

#### Scenario: Baking capability absent
- **WHEN** the platform cannot bake the available ground-truth formats
- **THEN** the provider falls back to the previous behavior: suppressed features plus an explicit bake-unavailable diagnostic

#### Scenario: Bake provenance is recorded
- **WHEN** a baked body is emitted
- **THEN** its label and provenance identify the source Onshape studio and the feature span it stands in for

### Requirement: Final-studio bakes SHALL explicitly supersede imported body outputs
When Onshape emits a whole-studio final tessellation bake, the prepared `bakedBody` action SHALL declare a deferred replacement scope over prior `createFeature` outputs in that import's ordered action span. Apply-time materialization SHALL resolve that scope to durable body IDs; it SHALL NOT predict IDs, infer correspondence from geometry, or target bodies outside the import span.
### Scenario: Ground-truth body membership is preserved
- **GIVEN** captured tessellation provides multiple `bodies[]` groups
- **WHEN** the provider bakes the studio geometry
- **THEN** the baked asset contains one explicit, ordered triangle range per captured body group
- **AND** body membership is not reconstructed from mesh geometry
