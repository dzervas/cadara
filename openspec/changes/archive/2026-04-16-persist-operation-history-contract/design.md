## Context

The current editor and modeling flows treat the kernel-backed document snapshot as the runtime source of truth, but that state is only durable for the current in-memory session. The modeling boundary already has typed contracts for sketch commits, feature mutations, rebuild results, and versioned feature definitions, which means the missing piece is not how to describe individual operations but how to record them as a durable, replayable document history.

This change spans multiple layers:
- `src/contracts/modeling/**` must define the persisted/exported operation-log payload and the exact operation entry variants.
- `src/domain/modeling/**` must append committed operations, replay them through the kernel, and surface deterministic failure behavior.
- Editor/runtime startup code must load the persisted history before the initial snapshot request so refresh restores the same document by replay rather than by ad hoc cache hydration.

The user also wants this format to become the future export contract. That makes the operation-log schema a public boundary rather than an internal persistence detail, so it needs explicit versioning and tight typing.

## Goals / Non-Goals

**Goals:**
- Define one versioned operation-history payload that works for local persistence and future export/import.
- Capture every committed modeling mutation needed to rebuild the document, including sketch commits and feature create, update, delete, and reorder operations.
- Rebuild documents after refresh by replaying the persisted history through the modeling kernel instead of restoring opaque snapshots.
- Make replay deterministic by storing operations in committed order with explicit payload versions and identifiers.
- Specify validation and recovery behavior when persisted history is invalid, unsupported, or only partially replayable.

**Non-Goals:**
- Persist transient UI state such as selection, hover, active tool, hidden rows, or in-progress draft sessions.
- Persist preview requests or preview renderables.
- Introduce cloud sync, multi-document storage, or a finalized file import/export UI in this change.
- Replace the document snapshot contract; snapshots remain the derived runtime/read model produced after replay.

## Decisions

### Persist the operation log, not the snapshot
Persisted state will be the committed modeling operation history rather than the latest `DocumentSnapshot`.

Rationale:
- The user explicitly wants refresh to recalculate state through the kernel.
- Snapshot persistence would bypass rebuild logic and allow contract drift between local restore and future export/import.
- A replayable history is the stronger contract because it exercises the same authoring path used by live mutations.

Alternative considered:
- Persist the last snapshot and treat replay as an occasional export step. This is simpler at startup, but it creates two document formats and makes replay correctness optional instead of mandatory.

### Operation entries mirror committed kernel mutation families
The history contract will use a closed union of operation entry kinds aligned with current committed mutation families:
- `commitSketch`
- `createFeature`
- `updateFeature`
- `deleteFeature`
- `reorderFeature`

Each entry will store the authoritative typed request payload required to replay that mutation, excluding only transport-level fields that are derived at runtime such as top-level request IDs.

Rationale:
- The modeling contract already defines these mutation families precisely.
- Reusing those shapes reduces schema duplication and keeps the export contract aligned with kernel expectations.
- A closed union prevents hidden one-off persistence records from appearing outside the contract.

Alternative considered:
- Persist editor events from the UI state machine. That would capture more user intent, but those events include transient command/session behavior that should not be part of the durable document format.

### History only records successful committed mutations
Entries are appended only after the kernel accepts a mutation as committed. Rejected requests, preview evaluations, and transient draft edits are not persisted.

Rationale:
- The exported contract should describe document history, not user experimentation.
- Appending rejected or preview operations would make replay dependent on UI-time branching and stale diagnostics.

Alternative considered:
- Record all user attempts with outcome metadata. That can be valuable for analytics or undo journals, but it weakens the document contract and expands scope beyond durable rebuild.

### Startup restore replays into a fresh kernel-backed document
Application startup will load the persisted operation-log payload from `localStorage`, validate the history schema version, instantiate a fresh document basis, and replay entries sequentially through the modeling service/kernel before exposing the initial snapshot to the editor runtime.

Rationale:
- Sequential replay preserves the same dependency order as authoring time.
- Routing restore through the same service boundary keeps diagnostics and rebuild rules consistent.

Alternative considered:
- Replay directly inside persistence code by bypassing the modeling service. That would couple storage to kernel details and duplicate request-normalization logic already owned by the service boundary.

### Replay failures are explicit and stop persistence trust
If history validation fails or kernel replay rejects an entry, the system will stop trusting the restored history for that session, surface diagnostics, and avoid silently fabricating a partially rebuilt document as if replay succeeded.

Rationale:
- The user asked to treat the format as a contract.
- Silent partial restores would undermine export safety and make contract breakage hard to detect.

Alternative considered:
- Best-effort replay that skips bad entries. This improves resilience, but it creates ambiguous document state and makes exported history semantically unreliable.

### Local storage remains a transport, not the schema owner
`localStorage` stores the serialized operation-log document under a stable application key, but the schema ownership lives in `src/contracts/modeling/**` with explicit version constants and runtime validation.

Rationale:
- The same payload must later work for export/import.
- Keeping schema ownership in contracts prevents storage-specific drift.

Alternative considered:
- Define an ad hoc JSON blob at the persistence layer and translate it later for export. That delays the contract work and increases migration risk.

## Risks / Trade-offs

- [Replay cost grows with document length] -> Keep replay deterministic now, and leave snapshot caching or checkpointing as a future optimization once the contract is stable.
- [Kernel contract changes can invalidate stored histories] -> Version the operation-log payload and entry shapes explicitly, and reject unsupported versions with diagnostics instead of guessing migrations.
- [Existing mutation requests include runtime-derived fields] -> Define persistence-specific entry payloads that reuse authoritative mutation shapes while omitting transport-only fields such as request IDs.
- [Partial local data corruption could block restore] -> Validate the entire persisted payload before replay and provide a clear reset/recovery path in implementation.
- [Multiple storage concerns may creep into UI code] -> Keep persistence orchestration near the modeling service/bootstrap path rather than scattering `localStorage` calls across presentational components.

## Migration Plan

1. Introduce the versioned operation-history contract and runtime validators.
2. Append history entries after successful sketch and feature mutations.
3. Load and replay persisted history during workbench/modeling bootstrap before the editor runtime consumes its first snapshot.
4. Gate the initial rollout to a single local document key and treat missing storage as an empty history.
5. On contract mismatch or invalid persisted data, fail restore explicitly and fall back to an empty document only after surfacing the invalid-history condition through diagnostics or a reset path.

Rollback:
- Stop reading the persisted history key and disable history writes.
- Existing `localStorage` data can remain in place because it is additive and externally inert once the reader is disabled.

## Open Questions

- Should the replay contract include document settings such as tolerance and units in the history header, or are those guaranteed by a single fixed application profile for now?
- Should the implementation preserve one stable document ID across restores, or treat the document identity as derived from the restored history load?
- Do we want a checksum or entry count in the top-level payload now, or is schema version plus full validation enough for the initial contract?
