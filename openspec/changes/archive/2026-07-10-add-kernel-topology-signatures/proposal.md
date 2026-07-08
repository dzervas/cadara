# Add Kernel Topology Signatures

## Why

The `add-onshape-import-provider` change defines a sandboxed history evaluation probe on `ImportCapabilities` — per-step topology signatures (entity class, geometry type, defining data, centroid, bounding box) for a candidate action sequence — but ships with the capability explicitly absent, because the kernel exposes no per-entity geometric signatures: `BodyTopologySnapshotRecord` carries face/edge/vertex ids without geometry.

The cost of that absence is measured, not hypothetical: live capture of the two spike documents shows 96 of 234 deterministic references unresolvable without mid-history topology interrogation, and every feature consuming one plans as `baked` with downstream features suppressed. Ground-truth deviation verification is likewise reported as unavailable. Implementing the probe converts both directly into parametric fidelity, and the extraction primitive is reusable beyond import (measurement, debugging, future exchange formats).

The foundation already exists: the native exact-B-rep payload path (`OccNativeExactBrepTableLayout`) carries real surface/curve records because `.cadara` export requires them, and the native topology payloads carry bounds. Signature extraction is therefore primarily a mapping layer over existing kernel payloads plus a sandboxed session wrapper — not new native OCC binding work, unless verification (task 1.1) shows the current wasm build does not populate the required records.

## What Changes

- Add **kernel topology signature extraction**: derive per-entity geometric signatures (entity class; geometry type such as plane/cylinder/cone/sphere/line/circle; defining data such as plane origin+normal, cylinder axis+radius; centroid approximation; bounding box) from the native exact-B-rep and topology payloads, keyed by durable topology references.
- Add a **sandboxed kernel session** on the existing kernel worker path that rebuilds a candidate action sequence in isolation — no authored document, operation history, undo state, or persistent cache mutation — and returns per-step signatures and structured step diagnostics.
- **Implement the import history probe**: wire the sandboxed session as the `ImportCapabilities` probe implementation in platform composition, replacing explicit absence on OCC-backed platforms.
- **Activate probe-dependent Onshape import paths** built in `add-onshape-import-provider` against the mock probe: signature matching for face sketches, edge selections, and body scopes, and ground-truth deviation verification in review.
- Record the fidelity gain: re-run the import smoke on both reference bundles and compare per-tier counts against the probe-less baseline.

Out of scope: capture-side improvements (per-history-point resolution / rollback snapshots — a future `onshape-capture-bundle` v2 change), matcher heuristics beyond those already specified, and any non-import consumer of signatures (they get the primitive, not new features).

## Capabilities

### New Capabilities

- `kernel-topology-signatures`: Defines geometric signature extraction from kernel topology payloads, the sandboxed history-evaluation session and its isolation guarantees, and probe availability on OCC-backed platforms.

### Modified Capabilities

None. The probe contract and its absence/presence semantics were specified in `import-provider-contract` by `add-onshape-import-provider`; this change implements the capability without altering the contract. The Onshape provider's probe-present behavior is likewise already specified.

## Impact

- Affected code: new signature extraction module over `src/domain/modeling/occ/native-topology-payload.ts` consumers, sandboxed session in the OCC worker/adapter seam (`src/domain/modeling/occ/`, `src/infrastructure/`), probe wiring in platform capability composition, removal of the explicit-absence stub for OCC-backed platforms.
- Affected APIs/contracts: none — implements existing contracts (`ImportCapabilities` probe, probe-present provider scenarios).
- Dependency impact: depends on `add-onshape-import-provider` (probe contract, mock-probe-tested matcher and verification). Interacts with `modernize-occ-kernel-topology` phase 5 (OCCT 8/BRepGraph): extraction consumes payloads through the native payload contract so the shim→BRepGraph migration does not change this layer.
- Performance impact: probe rebuilds are O(history length) kernel operations per import review, on the worker, with session reuse across steps; signature derivation batches per step. No impact outside import flows.
- Testing impact: logic-lane `bun:test` for signature derivation from payload fixtures and sandbox isolation guarantees; import-provider activation covered by flipping the existing mock-probe suites to the real capability behind the same interface. Manual smoke re-run recorded in change notes.

## Assumptions and Open Questions

- **Assumption:** the current wasm build populates real surface/curve records in the exact-B-rep payload (the payload path guards this with an explicit diagnostic). Task 1.1 verifies this first; if records are missing, the change grows a native shim task and the estimate increases — surfaced before further work, not discovered at the end.
- **Assumption:** centroid approximation (face bbox center or mesh-derived) is sufficient for matching given signatures also carry type + defining data + bbox; exact `BRepGProp` centroids are a fallback if matching precision proves inadequate on real models.
- **Open question:** session pooling/reuse policy across probe invocations within one import review — implementation-time decision bounded by the isolation guarantees.
