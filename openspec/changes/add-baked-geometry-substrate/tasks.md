## 1. Contract

- [ ] 1.1 Add the `bakedBody` feature definition variant (asset id, format, provenance, label) to the modeling contract + runtime schema, with Typia validation and `.spec.ts` accept/reject coverage (logic lane, per `docs/testing.md`).
- [ ] 1.2 Define baked-body diagnostics (asset missing, format invalid, materialization failed).

## 2. Baking Capability

- [ ] 2.1 Implement `bakeGeometry` in `createImportCapabilities`: format validation, content-hash dedup, persistence through `GeometryAssetStore`, structured failures; remove the throwing stub.
- [ ] 2.2 Add `.spec.ts` coverage: happy path, dedup, invalid bytes, unsupported-format capability error.

## 3. Kernel Materialization

- [ ] 3.1 Implement `bakedBody` in `MockKernelAdapter` (logic-lane body with durable ids).
- [ ] 3.2 Implement mesh→faceted-shape materialization in the OCC path (worker + adapter), with durable topology ids, render mesh, and export participation.
- [ ] 3.3 Add coverage: mock-kernel rebuild spec; OCC materialization spec alongside existing OCC feature specs; downstream boolean-on-baked-body case.
- [ ] 3.4 **Gate:** assess adding `STEPControl_Reader` to `opencascade-recipe.yaml`; record findings (binary-size and effort) in change notes; implement `step` format only if cheap, otherwise document deferral.

## 4. Onshape Provider Integration

- [ ] 4.1 Emit a `bakedBody` action from ground-truth tessellation when the plan requires a studio bake; wire provenance/labeling; keep the capability-absent fallback.
- [ ] 4.2 Update planner/provider `.spec.ts` fixtures; extend `apply-pipeline.spec.ts` with a chain ending in a baked body.
- [ ] 4.3 Feature-tree presentation: baked source features visible with reason codes; `bakedBody` feature labeled with its source span.

## 5. Verification

- [ ] 5.1 Manual smoke: re-import Taskariki — a correct solid must be visible; record in change notes with the per-tier table (unchanged tiers, new materialization column).
- [ ] 5.2 Run `bun run test:all`.
