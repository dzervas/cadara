## 1. Equality And Load Routing

- [x] 1.1 Add or extract a shared authored-document equality helper that compares parsed authored documents after any required active `documentId` normalization.
- [x] 1.2 Update filesystem-bound worker `load` so it reads and validates the bound file, compares it to the cached repository load document, and returns the cached load result without `repository.mutate` when they match.
- [x] 1.3 Preserve the existing mismatch path so changed bound files refresh the repository from disk and return the mutation result.
- [x] 1.4 Preserve existing no-binding, invalid-file, unreadable-file, and repository-load-failure behavior without falling back to stale cache.

## 2. Cache Metadata Preservation

- [x] 2.1 Ensure reused cached load results preserve repository heads, source, storage key, diagnostics, and asset availability exactly.
- [x] 2.2 Ensure matching linked-file reloads do not enqueue initialization autosync writes or emit no-op repository mutation notifications.
- [x] 2.3 Verify document-id normalization happens before equality checks so a linked file can match the active cached document even if its stored id differs.

## 3. Logic Tests

- [x] 3.1 Review `docs/testing.md` before editing tests and keep this coverage in the `logic` lane because the seam is worker/repository orchestration.
- [x] 3.2 Add worker-runtime coverage for a matching linked file returning the cached load result with no repository mutation and no filesystem write.
- [x] 3.3 Add worker-runtime coverage for a matching linked file whose serialized JSON differs but parsed authored document content matches.
- [x] 3.4 Add worker-runtime coverage for a matching linked file whose stored document id differs but matches after active id normalization.
- [x] 3.5 Add worker-runtime coverage for a changed linked file refreshing repository state from disk with no initialization autosync write.
- [x] 3.6 Add worker-runtime coverage for invalid and unreadable linked files failing explicitly without returning cached document or geometry state.
- [x] 3.7 Add worker-runtime coverage for browser-only/no-binding loads bypassing linked-file comparison.
- [x] 3.8 Add repository/client coverage only if transport behavior changes are needed to preserve metadata or asset availability.
- [x] 3.9 Add a modeling-service seam test only if worker-level result reuse is not sufficient to prevent downstream restore/rebuild on unchanged metadata.

## 4. Validation

- [x] 4.1 Run the targeted logic tests for the changed worker/repository files.
- [x] 4.2 Run `bun run test:all`.
- [x] 4.3 Update OpenSpec task checkboxes as implementation work completes.
