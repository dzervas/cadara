## ADDED Requirements

### Requirement: Native topology identity SHALL be kernel-owned
The OCC kernel implementation SHALL use kernel-owned topology identity for body, face, edge, and vertex references instead of app-authored traversal indexes or topology-token strings as the authoritative identity source.

#### Scenario: OCCT 8 graph identity is available
- **WHEN** the browser OCC runtime is built with usable OCCT 8 BRepGraph support
- **THEN** durable topology identity is derived from graph-owned identity such as BRepGraph persistent UIDs and graph history
- **AND** the adapter does not derive authoritative topology identity from `TopExp.MapShapes` enumeration order

#### Scenario: Fresh topology is created
- **WHEN** a feature creates topology that does not correspond to a unique kernel-history successor
- **THEN** the kernel assigns fresh kernel-owned topology identity
- **AND** the generated public durable reference is derived from that kernel identity rather than a body/token/index traversal position

### Requirement: Native topology kernel SHALL batch high-volume OCC data extraction
The OCC kernel implementation SHALL expose native batch APIs that return flat payloads for topology, adjacency, render meshes, exact B-rep records, export geometry, and reference invalidations.

#### Scenario: Snapshot payload is built
- **WHEN** the OCC adapter builds a committed modeling snapshot
- **THEN** topology ids, face/edge/vertex maps, adjacency, render meshes, and reference invalidations are returned through a native batch payload
- **AND** TypeScript does not perform per-face, per-edge, or per-vertex OCC object traversal to reconstruct the same payload

#### Scenario: Exact B-rep payload is built
- **WHEN** the kernel exports or persists exact Cadara B-rep topology from an OCC shape
- **THEN** vertices, edges, coedges, loops, faces, shells, solids, curves, surfaces, trims, and fallback triangles are extracted through a native batch payload
- **AND** JavaScript does not iterate OCC topology objects node-by-node to assemble the exact B-rep record

#### Scenario: Mesh export payload is built
- **WHEN** the user exports a tessellated geometry format
- **THEN** the kernel returns a flat mesh payload for the selected body and requested accuracy
- **AND** JavaScript does not fetch each face triangulation and each triangle node through individual OCC calls

### Requirement: Native topology kernel SHALL use transferable binary payloads
The OCC kernel implementation SHALL return large topology, mesh, exact B-rep, adjacency, identity, and diagnostic payloads through compact table-oriented data structures backed by transferable binary buffers where practical.

#### Scenario: Large mesh payload is returned
- **WHEN** the native kernel returns render or export mesh data for one or more bodies
- **THEN** vertex positions, normals, triangle indices, face bindings, and related ids are transferred as compact buffers or buffer-backed tables
- **AND** the worker boundary does not require a large nested JavaScript object graph for every vertex, triangle, or face

#### Scenario: Topology table payload is returned
- **WHEN** the native kernel returns body topology and adjacency
- **THEN** body, face, edge, vertex, coedge, loop, shell, solid, and adjacency records are represented as stable table data
- **AND** TypeScript constructs any ergonomic views from the transferred payload after the boundary crossing

### Requirement: Native topology kernel SHALL execute feature-history transactions natively
The OCC kernel implementation SHALL support native transaction commands for committed feature-history rebuilds that create or replace shapes, collect history, validate results, update caches, and emit topology payloads in one kernel operation.

#### Scenario: Feature rebuild transaction executes
- **WHEN** the adapter rebuilds a committed feature history containing mutating solid operations
- **THEN** the native kernel command creates or updates OCC shapes, collects operation history, reconciles topology identity, validates the result, updates derived cache state, and returns the resulting payload
- **AND** JavaScript does not orchestrate the operation by repeatedly pulling intermediate OCC handles and subshapes across the Wasm boundary

#### Scenario: Transaction cannot provide reliable history
- **WHEN** a native feature transaction cannot produce reliable history for affected topology
- **THEN** the kernel returns structured diagnostics or conservative invalidations
- **AND** it does not remap durable references through enumeration-order heuristics

### Requirement: Native topology kernel SHALL incrementally invalidate derived caches
The OCC kernel implementation SHALL maintain graph-backed or native-state-backed caches for derived topology data and invalidate them incrementally when kernel mutation information is available.

#### Scenario: Local topology mutation updates derived data
- **WHEN** a committed feature mutates a subset of body topology and the kernel can identify affected graph nodes or subshapes
- **THEN** cached adjacency, mesh, bounds, and exact-extraction data for unaffected topology remains reusable
- **AND** affected derived data is invalidated or recomputed before it is returned

#### Scenario: Unsupported mutation scope is encountered
- **WHEN** the kernel cannot determine the affected cache scope for a mutation
- **THEN** it invalidates the relevant body-level caches conservatively
- **AND** it does not return stale mesh, adjacency, bounds, or exact B-rep data

### Requirement: Native topology kernel SHALL validate and heal committed solid results
The OCC kernel implementation SHALL apply a consistent committed-result validation, healing, and tolerance policy before accepting mutating solid results into the authored modeling state.

#### Scenario: Solid result is valid after conservative healing
- **WHEN** a mutating feature produces a solid result that requires safe tolerance normalization, same-parameter repair, or conservative same-domain cleanup
- **THEN** the kernel applies the configured repair policy
- **AND** topology history and reference reconciliation use the final accepted shape or graph state

#### Scenario: Solid result is invalid or unsafe to repair
- **WHEN** a mutating feature produces an invalid result or repair would change the authored operation semantics
- **THEN** the kernel rejects the result with structured diagnostics
- **AND** the result is not accepted through partial topology identity remapping

### Requirement: Native topology kernel SHALL use kernel history for reference stability
The OCC kernel implementation SHALL preserve, delete, or mark ambiguous durable topology references using kernel-owned operation history and graph history.

#### Scenario: Unique successor exists
- **WHEN** a previous face, edge, or vertex has exactly one current successor of the same topology kind after a mutating operation
- **THEN** the kernel preserves that durable topology reference for the current successor

#### Scenario: Referenced topology is deleted
- **WHEN** kernel history reports that a referenced face, edge, or vertex was deleted or removed
- **THEN** the kernel reports a structured deleted-topology invalidation
- **AND** it does not remap the reference to a different surviving topology item

#### Scenario: Referenced topology has ambiguous successors
- **WHEN** kernel history reports multiple plausible current successors for a referenced topology item
- **THEN** the kernel reports a structured ambiguous-topology invalidation
- **AND** it does not choose one successor by traversal order

### Requirement: Pre-8.0 native shim SHALL be temporary and deletion-bound
Before the OCCT 8/BRepGraph migration is available, the implementation MAY use a native pre-8.0 shim around OCCT 7.x APIs, but that shim SHALL be explicitly temporary and SHALL be eliminated once the OCCT 8/BRepGraph path is adopted.

#### Scenario: Pre-8.0 shim is introduced
- **WHEN** implementation adds a native shim around OCCT 7.x topology, history, naming, meshing, or exact B-rep extraction APIs
- **THEN** the shim includes a clear code comment stating that it is temporary and must be deleted after the OCCT 8/BRepGraph migration
- **AND** the OpenSpec tasks track the shim deletion as required work

#### Scenario: OCCT 8 graph migration is complete
- **WHEN** the kernel uses OCCT 8/BRepGraph identity and history for committed topology reconciliation
- **THEN** the pre-8.0 shim is removed
- **AND** no compatibility path remains that preserves the old app-authored traversal-token topology identity model

### Requirement: Native topology kernel SHALL fail loudly when required native support is unavailable
The OCC runtime SHALL reject startup or feature execution with structured diagnostics when required native topology-kernel support is missing from the loaded custom OCC build.

#### Scenario: Native topology entrypoint missing
- **WHEN** the browser runtime loads a `cadara-occ` build that does not expose the required native topology-kernel entrypoints
- **THEN** the OCC adapter reports a structured runtime capability diagnostic
- **AND** it does not silently fall back to the old JS-side topology traversal implementation

### Requirement: Native topology kernel SHALL be measured with repeatable boundary-crossing checks
The implementation SHALL include repeatable verification for native payload correctness and boundary-crossing reduction.

#### Scenario: Native payload parity is checked
- **WHEN** the native topology kernel is enabled for representative feature histories
- **THEN** logic-lane tests verify stable references, invalid references, render topology, exact B-rep payloads, and export payloads against expected behavior

#### Scenario: Boundary-crossing reduction is checked
- **WHEN** native batching replaces a JS-side OCC traversal path
- **THEN** a repeatable benchmark, probe, or instrumentation check records the before/after boundary-crossing or rebuild-time impact
- **AND** the result is documented with the implementation rather than inferred from source shape
