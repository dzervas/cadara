# Add Onshape Capture Rollback Snapshots (Capture v2)

## Why

Capture v1 resolves deterministic-ID references against the **final** model state only. Measured cost: 96 of 234 references across the reference documents are `unresolved` because the referenced entity (a face consumed by a chamfer, an edge destroyed by a later cut, a mid-history body) no longer exists at the end of history. Every consuming feature is permanently baked no matter how good the import-side matching gets — including after the kernel probe lands, because there is no captured signature to match *against*. Additionally, the baked tier can only bake the whole-studio final body; per-feature body deltas need per-history-point geometry.

Capture v2 closes both gaps at the source: resolve references at the history point where they are consumed, and optionally snapshot per-feature geometry, by moving Onshape's rollback bar on an API-created temporary branch. The bundle format reserved `rollbackSnapshots` for exactly this.

## What Changes

- Add **per-history-point reference resolution** to the capture CLI: for each feature consuming deterministic IDs, evaluate the FeatureScript signature dump with the rollback bar positioned just before that feature, so references resolve against the state they were authored against. Existing final-state resolution remains the fast default; per-point resolution activates per-ID when final-state resolution fails.
- Add **per-feature rollback snapshots** (opt-in flag): tessellated geometry (and STEP when available) captured after each solid feature, populating the reserved `rollbackSnapshots` field — enabling future per-feature baked deltas and per-feature ground-truth verification.
- Add **workspace-safe mutation protocol**: all rollback-bar movement happens on a temporary branch/workspace created via the API from the captured microversion and deleted afterwards; the user's workspace is never mutated. Abort-and-cleanup on any failure; an undeletable temp branch is reported loudly with its id.
- Bump the bundle to **`formatVersion: 2`**, backward-compatibly: v2 adds `evaluatedAt: "historyPoint"` resolution records and populated `rollbackSnapshots`; the provider reads v1 and v2 (v1 keeps current behavior).
- Update the **Onshape provider** to prefer history-point resolutions when present, narrowing `capture-unresolved` passthroughs.

Out of scope: consuming rollback snapshots for per-feature baked deltas in the provider (a follow-up to this + the baked substrate), matcher changes (probe change owns matching), live/OAuth transport.

## Capabilities

### Modified Capabilities

- `onshape-capture-bundle`: format v2 (history-point resolution records, populated rollback snapshots, temp-branch capture protocol, version negotiation).
- `onshape-import-provider`: resolution-record preference order (history-point over final-state) and v1/v2 reading.

## Impact

- Affected code: `src/cli/commands/onshape-capture/` (branch lifecycle, rollback movement, per-point evaluation, snapshot capture), `src/contracts/import/onshape-capture-bundle.ts` (v2 schema), `src/domain/import/onshape/bundle-reader.ts` + planner (resolution preference), fixture transcripts (v2 sections).
- API usage impact: per-point resolution and snapshots multiply request counts by O(features); bounded concurrency and backoff already exist; snapshot capture is opt-in (`--rollback-snapshots`) to keep default captures cheap.
- Testing impact: logic lane against extended fixture transcripts — branch lifecycle (create/rollback/cleanup, cleanup-on-failure), per-point resolution records, v2 validation, v1/v2 reader compatibility; live smoke re-captures both documents and records resolution-rate deltas (expect the 96 unresolved to drop sharply).

## Assumptions and Open Questions

- **Assumption:** the Documents API supports creating and deleting a branch/workspace from a microversion with the capture key's permissions on the user's own documents. Verified feasible in principle (standard API surface); the first CLI task is a live probe of exactly this before deeper work.
- **Assumption:** rollback-bar movement via the features endpoint applies on the temporary workspace without affecting the source workspace (branches are isolated by design).
- **Open question:** snapshot capture cost on large documents (41 features × tessellation) — mitigated by opt-in flag and per-feature tolerance; measured during live smoke.
- **Open question:** whether read-only shared documents (user lacks branch rights) should degrade to v1 behavior with a diagnostic — proposed: yes, capture never fails solely because v2 extras are unavailable.
