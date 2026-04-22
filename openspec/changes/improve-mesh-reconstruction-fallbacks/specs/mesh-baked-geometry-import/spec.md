## ADDED Requirements

### Requirement: Mesh import SHALL show reconstruction quality before commit
The mesh import flow SHALL show reconstruction quality and fallback classification before committing a baked geometry result.

#### Scenario: Faceted fallback is available
- **WHEN** mesh conversion can only produce faceted baked geometry
- **THEN** the user sees a warning that the saved result will be faceted and the source mesh will not be retained
- **AND** the user must accept the result before the import feature is committed
