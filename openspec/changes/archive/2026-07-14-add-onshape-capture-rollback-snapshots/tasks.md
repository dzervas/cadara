## 1. Live Feasibility Probe

- [x] 1.1 **Gate:** live-verify branch create → rollback-bar move → featurescript eval → branch delete on a user-owned document; record the exact endpoints and any permission caveats in change notes before further work.

## 2. Bundle Contract v2

- [x] 2.1 Extend the envelope: `formatVersion: 2`, `evaluatedAt: "finalState" | "historyPoint"` records with consuming feature id, populated `rollbackSnapshots` shape; Typia validation for v1+v2, unknown-version rejection; `.spec.ts` coverage (logic lane, per `docs/testing.md`).

## 3. CLI Capture v2

- [x] 3.1 Implement temporary-branch lifecycle with abort-and-cleanup and loud leftover-branch reporting.
- [x] 3.2 Implement failure-triggered history-point resolution (batch per rollback position).
- [x] 3.3 Implement opt-in `--rollback-snapshots` per-feature geometry capture.
- [x] 3.4 Implement rights-degradation to v1 behavior with an explicit bundle diagnostic.
- [x] 3.5 Extend fixture transcripts with branch/rollback/snapshot exchanges; `.spec.ts` coverage: lifecycle, cleanup-on-failure, per-point records, degradation.

## 4. Provider Reading

- [x] 4.1 Bundle reader accepts v1+v2; planner prefers history-point records; `.spec.ts` coverage incl. v1 regression.

## 5. Verification

- [x] 5.1 Live smoke: re-capture both reference documents with v2; record resolution-rate deltas against the 96-unresolved v1 baseline and bundle-size impact in change notes.
- [x] 5.2 Run `bun run test:all`.
