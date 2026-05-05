## 1. Native Kernel Contract

- [x] 1.1 Define the native topology payload contract for bodies, topology ids, adjacency, render meshes, exact B-rep records, export meshes, and reference invalidations.
- [x] 1.2 Define transferable binary table layouts for topology, identity, adjacency, mesh, exact B-rep, and diagnostic payloads.
- [x] 1.3 Update the OCC worker protocol to route rebuild, snapshot, exact B-rep, and mesh export requests through the native topology payload boundary.
- [x] 1.4 Add runtime capability detection for required native topology entrypoints and structured diagnostics when the loaded OCC build does not expose them.

## 2. Temporary Pre-8.0 Shim

- [x] 2.1 Implement the pre-8.0 native shim around current OCCT topology, history, naming, meshing, and exact B-rep APIs.
- [x] 2.2 Add a clear code comment on the shim stating that it is temporary and must be deleted after the OCCT 8/BRepGraph migration.
- [x] 2.3 Bind the shim in `opencascade-recipe.yaml` and regenerate the browser OCC assets.
- [x] 2.4 Prove the shim returns native flat payloads without silently falling back to JS-side topology traversal.

## 3. Adapter Cutover

- [x] 3.1 Replace JS-side face, edge, and vertex enumeration in the OCC adapter with native topology payload consumption.
- [ ] 3.2 Replace JS-side topology naming/reconciliation loops with native kernel identity and history results.
- [ ] 3.3 Replace committed feature-history rebuild orchestration with native transaction commands where the kernel can create shapes, collect history, validate, cache, mesh, and emit payloads together.
- [x] 3.4 Replace render mesh extraction loops with native mesh payload consumption.
- [x] 3.5 Replace exact Cadara B-rep extraction loops with native exact B-rep payload consumption.
- [x] 3.6 Replace tessellated export traversal with native mesh export payload consumption.

## 4. Stability and Cache Policy

- [x] 4.1 Audit every mutating solid feature for usable kernel history and document unsupported history gaps.
- [x] 4.2 Make booleans, fillet, chamfer, shell, thicken, sweep, loft, split, mirror, and transform preserve or invalidate topology through native history where supported.
- [x] 4.3 Add committed-result validation, healing, same-parameter/same-range, same-domain cleanup, and tolerance-normalization policy.
- [x] 4.4 Add incremental invalidation for native topology, adjacency, bounds, mesh, and exact-extraction caches where mutation scope is known.
- [x] 4.5 Return structured diagnostics for operations that cannot produce reliable topology history or safe committed solid results instead of remapping by enumeration order.

## 5. OCCT 8/BRepGraph Migration

- [ ] 5.1 Build or integrate an OCCT 8-capable browser runtime with the BRepGraph APIs required by the native topology kernel.
- [ ] 5.2 Implement BRepGraph-backed topology identity using graph persistent identity and graph history as the authoritative source.
- [ ] 5.3 Move adjacency, validation, history reconciliation, and graph-backed extraction from the pre-8.0 shim to BRepGraph.
- [ ] 5.4 Remove the pre-8.0 shim and any compatibility path that preserves the old app-authored traversal-token topology identity model.

## 6. Verification

- [x] 6.1 Read `docs/testing.md` before editing tests and record the chosen lane/seam in the implementation update.
- [x] 6.2 Add logic-lane tests for unique-successor references across joins, same-domain simplification, and full authored-document rebuild.
- [x] 6.3 Add logic-lane tests for deleted and ambiguous topology references producing structured diagnostics.
- [x] 6.4 Add logic-lane tests for native payload parity across render mesh, exact B-rep, and mesh export paths.
- [x] 6.5 Add a repeatable benchmark, probe, or instrumentation check for boundary-crossing or rebuild-time reduction.
- [x] 6.6 Run `bun run test:all` and fix residual lint, build, unit, and e2e failures.
