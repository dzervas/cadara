## ADDED Requirements

### Requirement: Feature authoring SHALL represent mesh import provenance
Feature authoring SHALL record mesh import provenance and baked asset references without embedding source mesh data.

#### Scenario: Build mesh import definition
- **WHEN** a mesh import is accepted
- **THEN** the feature definition includes baked asset id, source format, original filename, source hash, resolved scale/orientation settings, and `sourceStored: false`
- **AND** the definition excludes raw mesh bytes and triangle arrays
