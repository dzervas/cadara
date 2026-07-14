## ADDED Requirements

### Requirement: Plane features SHALL support an explicit-frame creation mode
The modeling contract SHALL extend `PlaneFeatureParameters` with an `explicitFrame` mode carrying a fully-defined right-handed world-space frame (origin, X axis, Y axis, normal, document units), alongside the existing `coplanar` reference mode. Runtime validation SHALL reject frames that are not orthonormal right-handed within tolerance. The resulting feature SHALL produce a durable construction target like any other plane feature.

#### Scenario: Explicit-frame plane definition is accepted
- **WHEN** a create-feature request carries `kind: "plane"` with `mode: "explicitFrame"` and a valid orthonormal right-handed frame
- **THEN** contract validation accepts the request
- **AND** the rebuilt feature produces a durable construction target whose plane matches the provided frame

#### Scenario: Degenerate frame is rejected
- **WHEN** an explicit-frame plane definition carries axes that are not unit-length, not mutually orthogonal, or left-handed
- **THEN** runtime validation rejects the definition with a structured diagnostic
- **AND** no feature is created

#### Scenario: Coplanar mode is unchanged
- **WHEN** a plane feature uses the existing `coplanar` mode with a construction or face reference
- **THEN** behavior is identical to before this capability existed
