## Why

Boolean and feature replacement paths currently rebuild body topology with fresh tokenized subshape ids, so durable face and edge references can become invalid even when OpenCascade can identify an unchanged or evolved subshape. This blocks reliable downstream history workflows such as planes from pre-boolean faces, fillets from pre-simplification edges, and reference geometry that survives rebuilds.

## What Changes

- Adopt OCC's OCAF/TNaming naming APIs as the authoritative internal topology naming layer for OCC-backed rebuilds.
- Track body, face, edge, and vertex evolution through `TNaming_Builder`, `TNaming_Selector`, OCAF labels, and OCC shape history instead of relying on post-operation enumeration alone.
- Resolve durable topology references to current OCC subshapes when the naming layer produces a unique live result, and report explicit invalid or ambiguous-reference diagnostics when it does not.
- Preserve existing public durable reference shapes where possible; the OCAF document, labels, and naming records remain OCC adapter internals.
- Promote the existing topological naming limitation tests into the normal test suite and add more expected-failing coverage before the refactor is implemented.

## Capabilities

### New Capabilities

- `occ-durable-topology-naming`: Defines OCC-backed durable topology naming behavior, including OCAF/TNaming use, subshape identity carry-forward, ambiguity handling, and regression coverage.

### Modified Capabilities

- `durable-modeling-contract`: Durable topology references may remain valid across topology-changing operations when the kernel can prove a unique successor instead of treating all replacement topology as invalid.
- `occ-kernel-adapter`: The OCC adapter gains an internal OCAF/TNaming naming graph while preserving the public modeling contract boundary.
- `occ-basic-feature-operations`: OCC-backed booleans and downstream topology-targeted features must resolve stable pre-operation topology references where OCC naming can do so.

## Impact

- Affected code: `src/domain/modeling/occ/topology.ts`, `src/domain/modeling/occ/features.ts`, `src/domain/modeling/occ/authoring-state.ts`, snapshot/reference resolution, and OCC feature tests.
- Affected tests: promote `ignored-tests/occ-kernel-limitations/topological-naming.limit.spec.ts` into the default `bun test src` path and add additional topology naming regression scenarios.
- Dependencies: uses already-installed `opencascade.js` APIs including `TDocStd_Document`, `TDF_Label`, `TNaming_Builder`, `TNaming_Selector`, `TNaming_Tool`, `BRepAlgoAPI_BuilderAlgo.History()`, and `ShapeUpgrade_UnifySameDomain.History_*`.
- Public API impact: no intended public schema break; diagnostics may become more precise for ambiguous topology references.
