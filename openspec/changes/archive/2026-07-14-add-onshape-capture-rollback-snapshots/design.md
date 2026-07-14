# Design: Onshape Capture v2 — Rollback Snapshots

## Context

- Measured: 96/234 deterministic references unresolved at final state (mid-history-consumed entities); each permanently bakes its consumer regardless of import-side improvements, because no signature exists to match against.
- The v1 bundle reserved `rollbackSnapshots`; the capture protocol (auth, backoff, verbatim archival, no-partial-output) is established and unchanged.

## Decision 1: Temporary branch, never the user's workspace

All mutation (rollback-bar movement) happens on an API-created branch from the captured microversion, deleted afterwards. Failure policy extends no-partial-output: abort → attempt cleanup → loud leftover-branch report if cleanup fails. Missing branch rights degrade to v1 capture with an explicit bundle diagnostic — v2 extras never fail a capture.

## Decision 2: History-point resolution is failure-triggered, not exhaustive

Final-state resolution stays the single-pass default (cheap, resolves ~60%). Only IDs that fail get re-evaluated, batched by rollback position (one bar move per consuming feature that owns failures). Keeps request volume proportional to actual gaps instead of O(features × ids).

## Decision 3: Snapshots are opt-in

`--rollback-snapshots` captures post-feature tessellation (and STEP text) per solid feature for future per-feature baked deltas and per-feature ground-truth verification. Off by default: it multiplies capture cost and most imports don't need it until the baked-delta consumer exists.

## Decision 4: `formatVersion: 2`, additive

v2 adds `evaluatedAt: "historyPoint"` records (with consuming feature id) and populated `rollbackSnapshots`. Readers accept 1 and 2, reject unknown versions structurally. The provider's only behavioral change is preference order (history-point over final-state per consuming feature); v1 bundles plan byte-identically to today — covered by a regression scenario.

## Decision 5: Testing (per docs/testing.md)

Lane: **logic** against extended fixture transcripts — branch lifecycle including cleanup-on-failure, failure-triggered per-point evaluation batching, v2 schema validation and version negotiation, provider preference order with v1 regression. Live smoke (task 5.1) re-captures both reference documents and records the resolution-rate delta against the 96-unresolved baseline; live branch-rights probing is task 1.1's gate, executed before deeper work.


## Live Feasibility Probe (2026-07-14)

Probe target: `40a51fb8fa82fd4565151114` / workspace `a14bbd18c43e1cd99d2cfc48` / Part Studio `865452a3e2270f0ebca3ce63`.

- Read access succeeded through `GET /documents/d/{did}/w/{wid}/currentmicroversion`, `GET /documents/d/{did}/w/{wid}/elements`, and `GET /partstudios/d/{did}/w/{wid}/e/{eid}/features` (the target has 10 features).
- Initial workspace creation and deletion attempts returned HTTP 403: `Invalid API key state.` After refreshing the key with Delete permission, `POST /documents/d/{did}/workspaces` with `documentId`, the retrieved `microversionId`, and a unique `name` succeeded.
- `POST /partstudios/d/{did}/w/{temporaryWid}/e/{eid}/features/rollback` with `rollbackIndex: 0` and `POST /partstudios/d/{did}/w/{temporaryWid}/e/{eid}/featurescript?rollbackBarIndex=0` both succeeded on the verified temporary workspace.
- `DELETE /documents/d/{did}/workspaces/{temporaryWid}` then succeeded. The probe deleted only the temporary workspace after verifying its generated name and ID against the document workspace list; the source workspace was not mutated.
- Permission caveat: this API key requires Read, Write, and Delete permissions. In particular, the Delete scope is required for temporary workspace cleanup.


## Live Smoke (2026-07-14)

- Re-captured `40a51fb8fa82fd4565151114` / `865452a3e2270f0ebca3ce63` as v2: 17 references, 7 unresolved, 6 history-point records, 9,474,644 bytes.
- Re-captured `9841e486906fa2ce62d74d8e` / `a294dd6e940aa00fdcb206dc` as v2: 328 references, 129 unresolved, 105 history-point records, 24,774,238 bytes.
- Combined v2 result: 136 unresolved of 345 references (39.42%), compared with the recorded v1 baseline of 96/234 (41.03%): a 1.61 percentage-point reduction in unresolved rate. The raw counts are not directly comparable because the captured reference total changed.
- Combined v2 bundle size is 34,248,882 bytes (about 32.7 MiB). Historical v1 bundle byte sizes were not retained, so exact size impact cannot be calculated.

## Risks

- Branch create/delete permissions vary by plan/document sharing → gated live probe first; rights-degradation path specified.
- Leftover temp branches on crash → loud reporting with branch id; idempotent cleanup retry on next capture of the same document is a nice-to-have task if cheap.
- Request-volume growth on pathological documents → failure-triggered batching plus existing concurrency caps; measured in smoke notes.
