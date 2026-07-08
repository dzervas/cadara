## 1. Payload Verification

- [x] 1.1 Verify the current wasm build populates real surface/curve records in the exact-B-rep payload (`OccNativeExactBrepTableLayout`) for the geometry types needed (plane, cylinder, cone, sphere, line, circle); document findings in the change notes. **Gate:** if records are missing, stop and extend this change with the required native shim tasks before proceeding.
- [x] 1.2 Capture payload fixtures (topology + exact-B-rep tables) for representative bodies (box, cylinder boss, filleted block) for signature derivation tests.

## 2. Signature Extraction

- [x] 2.1 Implement signature derivation from native payloads: entity class, geometry type, defining data per supported type, bbox, centroid approximation; keyed by durable topology references; structured capability diagnostic when records are absent.
- [x] 2.2 Add `.spec.ts` coverage (logic lane, per `docs/testing.md`) against payload fixtures: each geometry type, unsupported-geometry fallback, missing-records diagnostic.

## 3. Sandboxed Session and Probe

- [x] 3.1 Implement the isolated kernel session on the worker path: rebuild candidate sequences, per-step signature collection, prefix results + step diagnostics on failure.
- [x] 3.2 Prove isolation: spec asserting an open document's state/history/undo/caches are unchanged across a probe run, and that probe failures do not leak.
- [x] 3.3 Wire the session as the `ImportCapabilities` probe in platform composition for OCC-backed platforms; keep explicit absence for builds that fail the payload gate.
- [x] 3.4 Add `.spec.ts` coverage for the probe contract against the real implementation (same suite shape as the provider's mock-probe tests).

## 4. Import Activation and Verification

- [x] 4.1 Flip the Onshape provider's probe-dependent suites from the mock probe to the real capability; confirm matcher and deviation verification behave per the probe-present scenarios without provider code changes.
- [x] 4.2 Manual smoke: re-import both reference capture bundles; record per-tier counts and deviation results, compared against the probe-less baseline from `add-onshape-import-provider` change notes.
- [x] 4.3 Run `bun run test:all`.
