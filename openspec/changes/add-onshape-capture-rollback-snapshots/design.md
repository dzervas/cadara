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

## Risks

- Branch create/delete permissions vary by plan/document sharing → gated live probe first; rights-degradation path specified.
- Leftover temp branches on crash → loud reporting with branch id; idempotent cleanup retry on next capture of the same document is a nice-to-have task if cheap.
- Request-volume growth on pathological documents → failure-triggered batching plus existing concurrency caps; measured in smoke notes.
