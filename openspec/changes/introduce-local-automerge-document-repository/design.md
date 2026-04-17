## Context

The current app keeps authoritative runtime state in `OpenCascadeKernelAdapter` and restores user work by replaying a versioned operation-history payload from localStorage through `ModelingService`. That replay log is useful for deterministic reconstruction, but it is not the right long-term authored document store for local-first collaboration. The UI already uses the modeling service boundary for mutations and snapshot refreshes, which gives this change a narrow integration point.

Automerge should be introduced as a persistence and future sync substrate, not as a React state model. The repository needs an explicit authored document shape because `KernelDocumentSnapshot` includes derived rows, diagnostics, render exports, and other data that should be regenerated from authored state instead of persisted into a CRDT document.

## Goals / Non-Goals

**Goals:**
- Introduce a `DocumentRepository` interface as the single boundary for authored document load, mutation, reset, and subscription.
- Store the canonical authored model document in an `automerge-repo` `Repo` backed by IndexedDB storage.
- Keep existing modeling service APIs stable for UI, editor machine, viewport, feature forms, and export flows.
- Rebuild existing workspace/kernel snapshots from authored state and OpenCascade.
- Preserve enough versioning and migration structure to evolve the authored document safely.

**Non-Goals:**
- No networked multiplayer, remote sync server, presence, account model, permissions, or sharing UI.
- No direct Automerge handles, docs, or change functions in React components or editor state-machine code.
- No persistence of derived render meshes, presentation tree rows, preview state, diagnostics, or OpenCascade runtime objects in Automerge.
- No redesign of feature authoring forms, toolbar behavior, or viewport interactions beyond the persistence boundary.

## Decisions

### Add `DocumentRepository` below `ModelingService`

`ModelingService` should remain the app-facing facade. A new repository module should sit below it and expose domain methods such as load, transact, subscribe, reset, and metadata queries in terms of authored CAD records rather than Automerge APIs.

Alternative considered: replace `ModelingService` with Automerge React hooks. That would leak persistence concerns into presentation code and make later kernel validation harder to centralize.

### Persist an authored document, not snapshots

The persisted document should contain identity, schema version, settings, variables, sketches, features, feature order, cursor, and user-authored labels. `KernelDocumentSnapshot`, presentation rows, diagnostics, render exports, and selection catalogs remain generated read models.

Alternative considered: store `snapshot.document` directly. That is simpler initially but would persist derived state, increase document size, and make migrations harder because render and diagnostics data can become stale.

### Use automerge-repo as the repository implementation

The first implementation should use `@automerge/automerge-repo` behind `DocumentRepository`, with `IndexedDBStorageAdapter` from `@automerge/automerge-repo-storage-indexeddb`. The app-level repository should own `Repo` and `DocHandle` usage internally and expose only typed authored document records and repository metadata.

This means Automerge-level snapshots, incremental chunks, storage range loading, and compaction stay in the `automerge-repo` storage layer. The app should not add a separate custom flattening layer unless measurements show a real need.

Alternative considered: hand-roll IndexedDB with direct `@automerge/automerge` `saveIncremental` chunks. That gives more control but makes the app responsible for compaction, range loading, corruption recovery, and multi-tab safety.

### Treat operation history as compatibility, not the primary store

The existing operation-history contract can remain useful for tests, diagnostics, import/export compatibility, or migration. Once `DocumentRepository` is enabled, startup restore should load the authored Automerge document first and only use operation history through explicit migration or compatibility paths.

Alternative considered: store the existing operation log inside Automerge. That is the smallest transition but preserves a replay-log model instead of making the current authored document explicit.

### Keep rebuild validation centralized

Repository transactions should update authored state only through modeling-service/kernel-approved mutation flows. After a mutation is accepted, the app should rebuild or hydrate the OpenCascade runtime from the authored document and return the existing response shape.

Alternative considered: let repository consumers directly edit the authored document and rebuild later. That would allow invalid CAD states to become durable and would scatter validation logic.

## Risks / Trade-offs

- [Automerge leaks into UI code] -> Enforce `DocumentRepository` as the only module importing Automerge packages, with tests or lint checks for forbidden imports outside the repository layer.
- [Persisted CRDT grows with derived data] -> Persist only authored records and explicitly reject render/presentation/runtime fields from the authored document schema.
- [Migration from localStorage loses existing work] -> Provide a one-time migration path from valid operation history into the authored document, plus explicit reset behavior when migration fails.
- [OCC rebuild cost on load becomes noticeable] -> Keep rebuild work centralized and measure before introducing cached derived snapshots.
- [IndexedDB or DocHandle failures are hard to diagnose] -> Surface restore status and repository diagnostics through existing workbench status/debug surfaces.

## Migration Plan

1. Add the authored document contract and `DocumentRepository` interface with an in-memory implementation for tests.
2. Add the `automerge-repo` IndexedDB implementation behind the same interface.
3. Teach `ModelingService` to load/hydrate from `DocumentRepository` before exposing snapshots.
4. Route accepted modeling mutations through repository transactions and rebuild the OCC read model from authored state.
5. Add a migration path from valid localStorage operation history into the authored document.
6. Keep reset behavior explicit: clearing local authored document data should recreate an empty seeded document.
7. Rollback by disabling the Automerge repository wiring and restoring the current operation-history store path while leaving non-used repository modules inert.

## Open Questions

- Should cadara export continue to export `KernelDocumentSnapshot`, or should a later import/export change introduce an authored-document-native file format?
- How much migration UI is needed if operation-history migration fails, beyond the existing restore failure message?
