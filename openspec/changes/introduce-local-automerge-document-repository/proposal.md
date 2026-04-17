## Why

The workbench currently restores modeled state by replaying a localStorage operation history into the in-memory OpenCascade adapter. Introducing a local-only Automerge-backed `DocumentRepository` gives the app a durable authored document layer in IndexedDB now while preserving a clean path to future multiplayer sync.

## What Changes

- Add a `DocumentRepository` abstraction that owns loading, mutating, subscribing to, and resetting the authored CAD document.
- Persist the authored document through `automerge-repo` with IndexedDB storage instead of relying on the current localStorage operation-history replay as the durable source.
- Define an explicit authored document shape for sketches, features, feature order, cursor, variables, labels, settings, schema version, and document identity.
- Keep Automerge hidden behind the repository so React components, editor machine code, feature forms, toolbar code, and viewport rendering continue to use modeling service contracts and snapshots.
- Rebuild the existing `KernelDocumentSnapshot` and presentation payload from the authored document and OpenCascade runtime rather than storing derived render or UI data in Automerge.
- Preserve existing modeling service mutation APIs and cadara export behavior, while routing accepted durable mutations through `DocumentRepository`.

## Capabilities

### New Capabilities
- `document-repository`: Defines the local authored document repository boundary, `automerge-repo`-backed IndexedDB persistence, restore/reset behavior, and isolation rules that prevent Automerge implementation details from leaking into UI or kernel consumers.
- `authored-model-document`: Defines the canonical persisted authored CAD document shape and its relationship to generated kernel snapshots and presentation payloads.

### Modified Capabilities
- `modeling-operation-history`: Operation-history replay is no longer the primary local durability mechanism once `DocumentRepository` is enabled.
- `durable-modeling-contract`: Durable modeling mutations and snapshots must be backed by the authored document repository while preserving the existing modeling service request/response surface.

## Impact

- Affected dependencies: add `@automerge/automerge-repo` and `@automerge/automerge-repo-storage-indexeddb`.
- Affected domain code: modeling service persistence orchestration, OpenCascade adapter hydration/rebuild paths, document serialization helpers, schema migration helpers, and local reset behavior.
- Affected contracts/specs: a new authored document contract and repository contract, plus changes to operation-history durability expectations.
- Affected tests: focused `bun:test` coverage for repository load/mutate/reset, restore from IndexedDB, schema validation/migration, snapshot rebuild from authored state, and no Automerge imports across UI/presentation layers.
