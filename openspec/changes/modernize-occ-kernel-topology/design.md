## Context

Cadara currently evaluates solid modeling in the browser through the OCC worker/runtime and then rebuilds public topology identity in TypeScript. The main paths involved are `topology.ts`, `topology-naming.ts`, `snapshot.ts`, `features/brep-topology.ts`, and export capability code. These paths repeatedly cross the JS/Wasm boundary to enumerate shapes, inspect algorithm history, extract meshes, extract exact B-rep records, and rebuild durable reference maps.

The current durable topology implementation uses internal OCAF/TNaming selectors and operation history, but public ids are still app-authored strings based on body id, topology token, and traversal index. That makes the implementation sensitive to traversal order and forces JS-side reconciliation over OCC object handles.

The intended end state is an OCCT 8/BRepGraph-backed kernel path. As of this proposal, the app's package/runtime is still based on `opencascade.js` with an OCCT 7.6.2-derived build, while upstream OCCT 8 release candidates expose BRepGraph concepts that fit this problem: typed node ids, persistent UIDs, direct adjacency, graph history, mutation guards, cache layers, validation, and TopoDS roundtrip conversion.

## Goals / Non-Goals

**Goals:**

- Make kernel-owned topology identity the source of truth for body, face, edge, and vertex identity.
- Use OCCT 8/BRepGraph as the target architecture for topology identity, adjacency, history, validation, and extraction.
- Collapse high-volume JS/Wasm crossings into native batch APIs returning flat payloads.
- Execute feature-history rebuild transactions natively where that reduces OCC handle round-trips.
- Use transferable binary payloads for large kernel outputs instead of large nested JS object graphs.
- Use graph/mutation-aware incremental caches for topology, adjacency, bounds, meshes, and exact extraction where available.
- Add committed-result validation, healing, and tolerance policy as part of kernel stability.
- Preserve or invalidate durable references through kernel-owned history rather than enumeration order.
- Make the pre-8.0 shim explicit, temporary, and delete-bound after OCCT 8 migration.
- Allow breaking contract changes where they simplify the kernel model.

**Non-Goals:**

- Maintaining compatibility with existing persisted topology ids.
- Keeping the current OCAF/TNaming selector layer as a permanent architecture.
- Solving all upstream OCCT robustness issues beyond using the best available OCCT APIs and recording clear diagnostics.
- Moving small TypeScript vector math into native code unless it is part of a larger native batch extraction.
- Adding pthread/threaded OCC runtime work.
- Moving STEP import/export native I/O into this change.
- Reworking higher-level geometric query APIs such as up-to-face/body/next, extrema, or measurement queries.
- Redesigning frontend selection or viewport UX beyond consuming the new kernel payloads.

## Decisions

### Decision: Target OCCT 8/BRepGraph as the real topology model

The implementation should treat BRepGraph as the intended kernel substrate once OCCT 8 is available in the browser build. BRepGraph's graph-owned identity, history, validation, direct adjacency, and roundtrip conversion align with Cadara's durable topology and boundary-crossing problems better than the current `TopExp.MapShapes` plus selector/history reconstruction.

Alternative considered: keep strengthening the existing OCAF/TNaming selector implementation. That can improve some cases, but it keeps public identity app-owned, still requires repeated JS-side OCC object queries, and does not use the newer graph-level identity model.

### Decision: Add a temporary pre-8.0 native shim, then delete it

Before the OCCT 8 browser build is usable, a native shim may wrap OCCT 7.x APIs such as `TopExp`, `TopTools_*`, `BRepTools_History`, `TNaming`, `BRep_Tool`, and `BRepMesh_IncrementalMesh`. The shim exists only to reduce boundary crossings and centralize reconciliation while the graph migration is blocked.

The shim must carry an implementation comment and tracked task stating that it is temporary and must be eliminated after the OCCT 8/BRepGraph migration. It must not become a compatibility abstraction that preserves the old identity contract.

Alternative considered: wait for OCCT 8 and do no pre-8 work. That avoids throwaway code, but it leaves the current expensive JS/Wasm traversal path in place and blocks measurement of the native transport shape.

### Decision: Native commands return flat kernel payloads

The worker should receive feature/rebuild commands and return flat data for body topology, stable topology ids, adjacency, reference invalidations, render meshes, exact B-rep records, and export data. TypeScript should validate and route these payloads, not drive per-face/per-edge OCC object traversal.

Alternative considered: expose more OCC classes to JavaScript. That makes the recipe larger and keeps the slow calling pattern.

### Decision: Feature-history execution is a native transaction boundary

Feature rebuild should move toward native transaction commands that create or replace shapes, collect operation history, validate/heal the result, update graph/cache state, mesh as needed, and emit one native payload. The TypeScript feature layer remains the source of authored contract interpretation, but the repeated OCC handle work should not be orchestrated one subshape at a time from JavaScript.

Alternative considered: only batch extraction after TypeScript executes each OCC operation. That reduces some payload extraction cost but leaves the highest-churn history/rebuild path split across the Wasm boundary.

### Decision: Large native payloads use transferable binary buffers

Native topology, adjacency, mesh, exact B-rep, and diagnostic payloads should be represented as compact tables backed by transferable binary buffers where practical. Object views can be constructed at the TypeScript boundary after transfer, but the worker/native boundary should avoid building giant nested JS object graphs.

Alternative considered: return plain structured-clone objects for readability. That is simpler initially, but it risks replacing OCC method-call overhead with serialization and allocation overhead.

### Decision: Graph-backed caches are incrementally invalidated

Topology tables, adjacency, meshes, bounds, and exact extraction outputs should be cached behind the kernel graph state and invalidated through mutation/history signals where available. Full regeneration remains allowed after unsupported operations, but the target architecture should not rebuild all derived payloads for every small topology change.

Alternative considered: keep snapshot generation stateless. That is easier to reason about but gives up a major advantage of BRepGraph's mutation/cache model.

### Decision: Committed solid results pass validation, healing, and tolerance policy

After mutating solid operations, the kernel should run a consistent committed-result policy: validate shape health, normalize safe tolerances, apply conservative healing/same-domain cleanup where semantically safe, and emit structured diagnostics when the result is invalid or repair would change meaning.

Alternative considered: rely on each OCC builder's `IsDone()` plus current ad hoc cleanup. That catches only operation completion, not downstream geometry stability.

### Decision: Operation history is mandatory for mutating solids

Every mutating solid feature that can preserve or invalidate topology must expose kernel history to the reconciliation layer. If a feature operation cannot provide usable history, the adapter must either mark affected topology conservatively invalid or reject the unsupported case with structured diagnostics.

Alternative considered: use geometric heuristics to match old and new topology. Heuristics may be useful as diagnostics or previews, but they should not be the authoritative durable topology contract.

### Decision: Tests cover behavior at the modeling seam

Coverage belongs primarily in the logic lane at the OCC adapter/modeling-service seam. Tests should verify stable references, deleted references, ambiguous references, rebuild parity, and native payload behavior. Static tests may enforce the temporary shim deletion marker, but behavioral coverage must not be replaced by source-shape checks.

## Risks / Trade-offs

- [Risk] OCCT 8/BRepGraph browser build is not immediately available or its API changes before final release. -> Mitigation: implement the native transport shape behind a temporary pre-8.0 shim, keep BRepGraph-specific code isolated, and validate against the actual custom build before broad migration.
- [Risk] The temporary shim becomes permanent compatibility debt. -> Mitigation: require an explicit deletion comment, a tracked task, and a static guard or review checklist that fails if the shim remains after the BRepGraph migration is marked complete.
- [Risk] Breaking topology ids invalidates existing documents. -> Mitigation: this is accepted by scope; implementation should fail loudly or migrate current test fixtures rather than preserving old ids.
- [Risk] Native payload bugs become harder to inspect from TypeScript. -> Mitigation: include debug dumps, payload validation, and targeted logic tests for topology maps, adjacency, history invalidations, and mesh/exact B-rep parity.
- [Risk] Batching everything at once makes the change hard to review. -> Mitigation: land in phases: native payload contract, pre-8 shim, adapter cutover, operation coverage, OCCT 8/BRepGraph cutover, shim deletion.

## Migration Plan

1. Define the native payload schema and worker protocol for topology identity, adjacency, render mesh, exact B-rep, and reference invalidations.
2. Define transferable table/buffer layouts for large payloads.
3. Add the pre-8.0 shim with an explicit deletion comment and a tracked removal task.
4. Move current JS-side topology enumeration, reconciliation, mesh extraction, and exact B-rep extraction behind the native payload.
5. Move feature-history rebuild execution toward native transaction commands.
6. Add committed-result validation, healing, tolerance normalization, and structured diagnostics.
7. Add incremental cache invalidation for topology, adjacency, meshes, bounds, and exact extraction where the kernel state can support it.
8. Upgrade the custom OCC build path toward OCCT 8/BRepGraph and add the required graph bindings/native helpers.
9. Cut identity and reconciliation over to BRepGraph UIDs/history.
10. Delete the pre-8.0 shim and any OCAF/TNaming compatibility layer that only existed for the bridge.

## Open Questions

- Is OCCT 8 final available and buildable through the current `opencascade.js`/Emscripten path at implementation time, or does the first implementation phase need to ship the pre-8.0 shim?
- Should the native payload be exposed as a custom linked library loaded by the existing runtime loader, or should it replace the generated `cadara-occ` binding surface?
- Which benchmark threshold should be used to prove boundary-crossing reduction: rebuild time, snapshot time, export time, JS OCC call count, or a combination?
