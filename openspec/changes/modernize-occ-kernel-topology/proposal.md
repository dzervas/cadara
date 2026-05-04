## Why

The current OCC kernel path still derives public topology identity through app-owned traversal tokens and resolves stability through repeated JS-side OCAF/TNaming/history queries, which creates avoidable Wasm crossings and leaves geometry stability weaker than the current Open CASCADE direction can offer.

Open CASCADE's 8.0 BRepGraph work is directly aligned with Cadara's needs: stable graph-owned topology identity, history tracking, direct adjacency, cache invalidation, validation, and flat topology access. Backwards compatibility and current public topology-id stability are intentionally out of scope; this change should optimize for the best available kernel-owned geometry stability.

## What Changes

- **BREAKING** Replace the current app-authored topology identity model with kernel-owned topology identity and reconciliation.
- **BREAKING** Replace repeated JS-side topology traversal, mesh extraction, exact B-rep extraction, and history reconciliation loops with native batch APIs that return flat transport payloads.
- **BREAKING** Make operation history and kernel-side reconciliation mandatory for mutating solid operations that preserve or invalidate durable topology.
- Add an OCCT 8/BRepGraph target architecture for topology identity, adjacency, native history, graph validation, and graph-backed extraction.
- Add a pre-8.0 native shim only as a temporary bridge around the currently available OCCT 7.x APIs. This shim must be explicitly marked for deletion and eliminated after the OCCT 8/BRepGraph migration lands.
- Add native feature-history execution so feature rebuilds can create shapes, collect history, validate, cache, mesh, and emit payloads through one kernel command rather than many JS-driven OCC calls.
- Add transferable binary payloads for topology tables, ids, meshes, exact B-rep data, and diagnostics so native batching does not reappear as large JS object graph churn.
- Add incremental topology, adjacency, mesh, bounds, and exact-extraction cache invalidation using the kernel graph/mutation model where available.
- Add a kernel validation, healing, and tolerance policy for committed solid results so geometry stability is not limited to topology naming.
- Upgrade the custom OCC build surface and runtime delivery plan to support the required native kernel API rather than binding isolated OCC classes for JS-side loops.
- Add verification expectations around stable successors, deleted/ambiguous references, native payload parity, rebuild behavior, and boundary-crossing reductions.

## Capabilities

### New Capabilities
- `occ-native-topology-kernel`: Defines the native kernel topology, identity, batching, OCCT 8 migration, and temporary pre-8.0 shim behavior.

### Modified Capabilities
- `occ-kernel-adapter`: Tightens the adapter contract so the browser modeling boundary consumes native kernel payloads and no longer reconstructs topology through repeated public JS-side OCC traversals.
- `occ-durable-topology-naming`: Replaces selector/token-centered durable topology preservation with kernel-owned identity and history, with BRepGraph UIDs/history as the intended OCCT 8 target.

## Impact

- Affected code: `src/domain/modeling/occ/runtime.ts`, `src/domain/modeling/occ/worker*.ts`, `src/domain/modeling/opencascade-kernel-adapter.ts`, `src/domain/modeling/occ/topology.ts`, `src/domain/modeling/occ/topology-naming.ts`, `src/domain/modeling/occ/snapshot.ts`, `src/domain/modeling/occ/features/**`, `src/domain/export/occ-export-capabilities.ts`, `src/domain/modeling/occ/features/brep-topology.ts`, `opencascade-recipe.yaml`, and generated `public/cadara-occ.*` assets.
- Affected APIs/contracts: OCC worker protocol, kernel adapter snapshot/mutation payloads, durable reference diagnostics, render export payloads, exact B-rep extraction payloads, and import/export materialization internals.
- Dependency impact: requires either a custom OCCT 7.x native bridge as an interim step or a direct custom OCCT 8/BRepGraph build once usable in the browser toolchain. The interim bridge must not become a permanent compatibility layer.
- Performance impact: focuses on feature-history execution batching, transferable binary payloads, graph-backed incremental cache invalidation, and native validation/healing. Threading, native STEP exchange, and richer geometric query APIs are intentionally left for separate follow-up work.
- Testing impact: logic-lane OCC adapter and topology naming coverage must be expanded before or alongside implementation; performance/boundary-crossing checks should be measured with repeatable harnesses instead of inferred from code shape.
