## ADDED Requirements

### Requirement: Baked geometry assets SHALL record reconstruction quality metadata
Generated baked geometry asset records SHALL include reconstruction quality metadata when they originate from mesh conversion.

#### Scenario: Asset originated from mesh reconstruction
- **WHEN** a baked asset is generated from STL or 3MF triangles
- **THEN** the asset manifest records result classification, algorithm id, algorithm version, settings summary, and source hash
- **AND** the manifest still indicates that source mesh bytes are not stored
