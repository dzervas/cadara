## MODIFIED Requirements

### Requirement: OCC adapter SHALL keep durable topology naming internally consistent
An OpenCascade-backed kernel adapter SHALL use native kernel-owned topology identity and history to reconcile topology references across rebuilds while preserving the public modeling contract boundary.

#### Scenario: Native topology identity is used during committed rebuild
- **WHEN** the adapter rebuilds committed authoring state containing body replacement operations
- **THEN** it records and resolves body topology through native kernel-owned topology identity and operation history
- **AND** it returns contract-valid snapshots, render bindings, and diagnostics without exposing OCC object handles, graph handles, OCAF labels, or kernel pointer identities

#### Scenario: Public topology ids are preserved for unique kernel successors
- **WHEN** an old face, edge, or vertex has exactly one current kernel-history successor in the final rebuilt body
- **THEN** the adapter keeps the existing public durable topology reference bound to that current subshape

#### Scenario: Fresh topology receives kernel-derived public ids
- **WHEN** a feature creates topology that is not the unique successor of any previous public topology reference
- **THEN** the adapter assigns fresh public durable topology ids derived from kernel-owned identity
- **AND** the ids do not depend on incidental JS traversal order

#### Scenario: Reference resolution uses final native payload
- **WHEN** a boolean result is simplified, same-domain unified, or graph-normalized before becoming the committed body shape
- **THEN** topology naming resolves references against the final native kernel payload for the stored body shape
- **AND** it does not leave durable references bound only to pre-refinement builder output

## ADDED Requirements

### Requirement: OCC adapter SHALL consume native topology payloads
An OpenCascade-backed kernel adapter SHALL consume native topology-kernel payloads for committed snapshot, rebuild, reference resolution, render export, exact B-rep extraction, and mesh export work.

#### Scenario: Committed snapshot is generated
- **WHEN** the adapter generates a committed snapshot for the application
- **THEN** topology references, render bindings, mesh buffers, and invalidation diagnostics come from the native topology payload
- **AND** adapter TypeScript does not reconstruct the same topology graph through repeated `TopExp.MapShapes`, `TopExp_Explorer`, or `BRep_Tool.Triangulation` loops

#### Scenario: Native topology capability is missing
- **WHEN** the loaded OCC runtime does not expose the required native topology payload entrypoints
- **THEN** the adapter reports a structured runtime capability failure
- **AND** it does not silently fall back to the previous JS-side topology traversal implementation
