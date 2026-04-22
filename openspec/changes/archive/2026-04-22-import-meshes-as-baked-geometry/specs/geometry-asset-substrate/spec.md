## ADDED Requirements

### Requirement: Baked mesh results SHALL be generated geometry assets
The geometry asset substrate SHALL store accepted mesh import results as generated immutable geometry assets, not as retained source mesh assets.

#### Scenario: Mesh import produces baked asset
- **WHEN** an STL or 3MF import commits
- **THEN** the asset manifest records a generated baked geometry asset with reconstruction provenance
- **AND** the manifest records that the original mesh source is not stored
