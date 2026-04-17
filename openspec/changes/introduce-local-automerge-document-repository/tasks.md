## 1. Authored Document Contract

- [ ] 1.1 Define the versioned authored model document TypeScript contract and runtime validation schema.
- [ ] 1.2 Add migration helpers for supported authored document schema versions and explicit unsupported-version diagnostics.
- [ ] 1.3 Add tests proving authored documents include rebuild inputs and exclude render, presentation, preview, diagnostics, and runtime fields.

## 2. DocumentRepository Boundary

- [ ] 2.1 Create the `DocumentRepository` interface for load, mutate, subscribe, reset, and restore status behavior.
- [ ] 2.2 Add an in-memory repository implementation for deterministic tests.
- [ ] 2.3 Add tests proving repository consumers never receive Automerge documents, handles, or transaction callbacks.

## 3. automerge-repo IndexedDB Persistence

- [ ] 3.1 Add `@automerge/automerge-repo` and `@automerge/automerge-repo-storage-indexeddb` dependencies.
- [ ] 3.2 Implement the IndexedDB `DocumentRepository` using an internal `Repo`, `DocHandle`, and `IndexedDBStorageAdapter`.
- [ ] 3.3 Add tests for missing-document seed creation, refresh restore, reset behavior, unsupported schema handling, DocHandle errors, and write failure diagnostics.

## 4. Modeling Service Integration

- [ ] 4.1 Wire `ModelingService` to load authored state through `DocumentRepository` before exposing snapshots.
- [ ] 4.2 Route accepted sketch, variable, feature, body label, reorder, and cursor mutations through repository transactions.
- [ ] 4.3 Rebuild OpenCascade runtime state and existing workspace snapshots from repository-authored state.
- [ ] 4.4 Ensure rejected mutations and preview evaluations do not mutate the authored document.

## 5. Operation History Migration

- [ ] 5.1 Preserve operation-history validation as a compatibility contract.
- [ ] 5.2 Add one-time migration from valid localStorage operation history into an authored repository document when no authored document exists.
- [ ] 5.3 Add explicit migration failure diagnostics without overwriting existing operation-history data.

## 6. Verification

- [ ] 6.1 Add boundary tests or lint coverage preventing Automerge and `automerge-repo` imports outside the repository implementation layer.
- [ ] 6.2 Update existing modeling service, export, and editor restore tests for repository-backed startup.
- [ ] 6.3 Run `bun run test`.
- [ ] 6.4 Run `bun run lint`.
