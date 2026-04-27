## ADDED Requirements

### Requirement: Reference-image creation SHALL not use the generic part import session
The raster image tracing workflow SHALL be owned by the sketch-mode `Import Image` tool and SHALL NOT use the generic part-mode import inspector or `importing` session.

#### Scenario: Sketch image import bypasses the part import inspector
- **WHEN** the user is editing a sketch and imports a raster image for reference tracing
- **THEN** the editor creates a sketch-owned `referenceImage` operation flow
- **AND** the editor does not enter the generic `importing` state

#### Scenario: Part-mode import remains reserved for part workspace imports
- **WHEN** the user activates the generic import button in part mode after this change
- **THEN** the workflow is limited to non-reference-image part workspace import providers
- **AND** raster reference-image creation is not offered through that inspector
