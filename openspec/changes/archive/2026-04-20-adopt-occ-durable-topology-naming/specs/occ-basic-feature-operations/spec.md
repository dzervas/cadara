## ADDED Requirements

### Requirement: OCC-backed topology-targeted features SHALL resolve named topology successors
OCC-backed features that consume durable face, edge, or vertex references SHALL resolve those references through the OCC topology naming layer before executing feature geometry.

#### Scenario: Plane references a face before later booleans
- **WHEN** a plane feature references a planar face that was selected before later boolean joins
- **THEN** the OCC adapter resolves the face to its current named successor before creating the plane
- **AND** the feature does not fail only because the body topology was replaced

#### Scenario: Fillet references an edge before same-domain simplification
- **WHEN** a fillet feature references an edge that was later carried through same-domain simplification
- **THEN** the OCC adapter resolves the edge to its unique current named successor before building the fillet

#### Scenario: Shell rejects a deleted face reference
- **WHEN** a shell feature references a face that earlier topology naming marked deleted
- **THEN** the OCC adapter rejects the feature with an invalid-reference diagnostic
- **AND** it does not apply the shell to a different surviving face

### Requirement: OCC-backed boolean operations SHALL preserve target topology where naming can prove continuity
OCC-backed extrude, revolve, shell, and Combine boolean operations SHALL preserve target body topology references through OCC naming when the final result contains a unique live successor.

#### Scenario: Join preserves unaffected target face
- **WHEN** a join operation adds material to one side of a target body
- **THEN** unaffected target faces and edges that OCC naming resolves uniquely remain live durable references after the join

#### Scenario: Subtract invalidates removed target topology
- **WHEN** a subtract operation removes a target face or edge
- **THEN** references to the removed topology are invalidated with a deleted-topology reason

#### Scenario: Intersect invalidates topology outside common volume
- **WHEN** an intersect operation removes target topology outside the common volume
- **THEN** references to removed target topology are invalidated instead of being rebound to unrelated common-volume topology
