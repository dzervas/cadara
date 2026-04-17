## 1. Authored Document Contract

- [x] 1.1 Define the versioned authored model document TypeScript contract and runtime validation schema.
- [x] 1.2 Add migration helpers for supported authored document schema versions and explicit unsupported-version diagnostics.
- [x] 1.3 Add tests proving authored documents include rebuild inputs and exclude render, presentation, preview, diagnostics, and runtime fields.

## 2. DocumentRepository Boundary

- [x] 2.1 Create the `DocumentRepository` interface for load, mutate, subscribe, reset, and restore status behavior.
- [x] 2.2 Add an in-memory repository implementation for deterministic tests.
- [x] 2.3 Add tests proving repository consumers never receive Automerge documents, handles, or transaction callbacks.

## 3. automerge-repo IndexedDB Persistence

- [x] 3.1 Add `@automerge/automerge-repo` and `@automerge/automerge-repo-storage-indexeddb` dependencies.
- [x] 3.2 Implement the IndexedDB `DocumentRepository` using an internal `Repo`, `DocHandle`, and `IndexedDBStorageAdapter`.
- [x] 3.3 Add tests for missing-document seed creation, refresh restore, reset behavior, unsupported schema handling, DocHandle errors, and write failure diagnostics.

## 4. Modeling Service Integration

- [x] 4.1 Wire `ModelingService` to load authored state through `DocumentRepository` before exposing snapshots.
- [x] 4.2 Route accepted sketch, variable, feature, body label, reorder, and cursor mutations through repository transactions.
- [x] 4.3 Rebuild OpenCascade runtime state and existing workspace snapshots from repository-authored state.
- [x] 4.4 Ensure rejected mutations and preview evaluations do not mutate the authored document.

## 5. Operation History Migration

- [x] 5.1 Preserve operation-history validation as a compatibility contract.
- [x] 5.2 Add one-time migration from valid localStorage operation history into an authored repository document when no authored document exists.
- [x] 5.3 Add explicit migration failure diagnostics without overwriting existing operation-history data.

## 6. Verification

- [x] 6.1 Add boundary tests or lint coverage preventing Automerge and `automerge-repo` imports outside the repository implementation layer.
- [x] 6.2 Update existing modeling service, export, and editor restore tests for repository-backed startup.
- [x] 6.3 Run `bun run test`.
- [x] 6.4 Run `bun run lint`.
