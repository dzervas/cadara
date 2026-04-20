## MODIFIED Requirements

### Requirement: Durable CAD references are explicit and typed
The CAD modeling contract SHALL identify documents, features, sketches, constructions, bodies, faces, edges, vertices, and sketch primitives through explicit typed references rather than incidental array order or ambiguous positional selection, and SHALL keep topology references live across topology-changing operations when the kernel can prove a unique current successor.

#### Scenario: Frontend addresses a consumed primitive
- **WHEN** a request references a body, face, edge, vertex, sketch entity, region, or construction
- **THEN** the request carries an explicit typed reference that identifies the durable target without relying on UI ordering or "first/second" positional meaning

#### Scenario: Topology changes preserve a uniquely resolved reference
- **WHEN** a topology-changing operation replaces a body but the kernel resolves a previous primitive reference to exactly one current successor
- **THEN** the contract continues to resolve that durable reference to the current primitive
- **AND** the result does not depend on incidental topology enumeration order

#### Scenario: Topology changes invalidate a destroyed reference
- **WHEN** a topology-changing operation destroys a previously referenced primitive and no current successor exists
- **THEN** the contract reports the invalid reference explicitly through diagnostics or invalid-reference reporting instead of silently remapping it to a surviving primitive

#### Scenario: Topology changes invalidate an ambiguous reference
- **WHEN** a topology-changing operation produces multiple plausible successors for a previously referenced primitive
- **THEN** the contract reports the invalid reference explicitly as ambiguous
- **AND** it does not silently choose one successor by traversal order, geometry heuristics, or UI ordering
