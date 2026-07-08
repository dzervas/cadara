## 1. Planner

- [x] 1.1 Model per-feature input dependencies in the fidelity planner (owning sketch, region source, deferred body lineage, explicit upstream references).
- [x] 1.2 Replace positional cascade with dependency propagation; keep boolean candidate counting honest across baked lineages (ambiguous → probe-gated).
- [x] 1.3 Add planner `.spec.ts` coverage (logic lane, per `docs/testing.md`): independent-branch liveness, true-dependent baking, boolean-candidate honesty; add a two-branch fixture history.

## 2. Verification

- [x] 2.1 Manual smoke: re-import both real bundles; record the new per-tier baseline section and deltas (expect Taskariki's independent chains — e.g. Sketch 8 → Extrude 13 — to go live).
- [x] 2.2 Run `bun run test:all`.
