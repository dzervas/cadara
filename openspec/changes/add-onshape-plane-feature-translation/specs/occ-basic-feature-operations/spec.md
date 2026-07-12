## MODIFIED Requirements

### Requirement: OCC-backed plane features create durable construction planes from supported references
The system SHALL allow plane features backed by the OpenCascade adapter to create durable construction planes from supported coplanar reference seeds and from explicit world-space frames.

#### Scenario: Create a plane from a construction plane
- **WHEN** the user creates a coplanar plane from an existing durable construction plane reference
- **THEN** the adapter accepts the feature and produces a new durable construction target for the resulting plane

#### Scenario: Create a plane from a planar face
- **WHEN** the user creates a coplanar plane from a valid planar face reference
- **THEN** the adapter accepts the feature and produces a new durable construction target for the resulting plane

#### Scenario: Create a plane from an explicit frame
- **WHEN** a plane feature carries `mode: "explicitFrame"` with a valid orthonormal right-handed frame
- **THEN** the adapter accepts the feature and produces a new durable construction target whose plane embeds the provided frame
- **AND** sketches committed on that construction target resolve their support in the OCC authoring state
