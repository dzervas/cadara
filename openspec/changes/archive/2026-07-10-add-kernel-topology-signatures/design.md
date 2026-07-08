# Design: Kernel Topology Signatures

## Context

- `add-onshape-import-provider` ships probe-less: its matcher and ground-truth verification are implemented and tested against a mock probe behind the `ImportCapabilities` interface, so this change activates them by providing the real capability — no provider code changes (verified by task 4.1).
- Measured stakes from the capture smoke runs: 96/234 deterministic references across the two reference documents need mid-history topology interrogation; each consuming feature currently plans `baked` with downstream suppression.
- Signature shape is fixed by two existing contracts: the capture bundle's `resolvedReferences` signatures (what we match *against*) and the probe contract in `import-provider-contract` (what we must *return*). This change adds no new contract surface.

## Decision 1: Extraction is a mapping layer over native payloads

Signatures derive from the native exact-B-rep tables (`OccNativeExactBrepTableLayout.surfaces`/curves — already required by `.cadara` export) and topology/bounds payloads, keyed by durable topology references. No per-entity JS-side OCC traversal (consistent with `occ-native-topology-kernel`), and no new native bindings unless the payload gate fails.

**Gate first (task 1.1):** the payload path carries an explicit diagnostic that the native build may lack "real OCC curve/surface records". Verifying record availability is the first task and a hard stop — if records are missing, the change grows native shim work and the estimate is revised *before* dependent work starts, not after.

## Decision 2: Isolation as a testable guarantee

The sandboxed session reuses the kernel worker but owns its shapes and caches; isolation is asserted by spec (task 3.2: open document state/history/undo/caches byte-identical across a probe run), not by convention. Failures return prefix results + step diagnostics — mirroring the probe contract — and never leak outside the session.

## Decision 3: Centroids are approximations until proven insufficient

Face bbox-center or mesh-derived centroids ship first; signatures also carry type + defining data + bbox, so matching rarely hinges on centroid precision. Exact `BRepGProp` properties are the named fallback if smoke results (task 4.2) show ambiguity rates that tolerance-ranking cannot absorb.

## Decision 4: Testing (per docs/testing.md)

Lane: **logic**. Seams: signature derivation from checked-in payload fixtures (per geometry type, unsupported fallback, missing-records diagnostic), sandbox isolation assertions, probe contract against the real implementation reusing the provider's mock-probe suite shape. Manual smoke (both reference bundles, per-tier counts vs the probe-less baseline) is recorded in change notes, not CI. No UI or e2e lanes.

## Risks

- Payload gate fails (records unpopulated in current wasm build) → change pauses at task 1.1 with findings documented; native shim tasks added under the `modernize-occ-kernel-topology` shim conventions (temporary, marked for deletion).
- Probe latency on long histories → session reuse across steps, batched signature derivation per step; import review already shows progress.
- OCCT 8/BRepGraph migration churn → extraction consumes the native payload *contract*, which the migration preserves; no coupling to shim internals.
