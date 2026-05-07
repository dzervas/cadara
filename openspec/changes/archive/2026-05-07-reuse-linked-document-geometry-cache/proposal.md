## Why

Filesystem-linked documents currently re-read the backing file on reload, but the load path treats that file as a replacement every time. When the disk file is byte-for-byte or semantically the same authored document already cached in the browser repository, this forces unnecessary repository mutation and downstream geometry rebuild work instead of reusing the cached document state.

Assumption: the linked filesystem file remains authoritative on reload. The cache can only be reused after the worker has successfully read and validated the current file and proven it matches the cached repository-authored document for the same document identity.

## What Changes

- Add a linked-file reload fast path that compares the validated file document with the cached repository document before refreshing repository state.
- Reuse the cached repository load result, including its existing geometry/asset availability metadata, when the file and cached document match after normalizing the loaded file to the active document id.
- Keep the existing authoritative-file behavior when the file differs: refresh the repository from the disk file, return the refreshed document, and avoid autosync-writing during initialization.
- Preserve explicit failure behavior for unreadable or invalid linked files; do not fall back to stale cached geometry when the authoritative file cannot be validated.
- Add regression coverage for matching files, changed files, invalid files, read failures, document-id normalization, metadata preservation, and no initialization autosync writes.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `local-file-system-document-sync`: Linked filesystem reload must compare the current disk file to the cached repository document and reuse cached geometry when they match.
- `document-repository`: Repository load results must remain reusable as the cache source when a higher-level filesystem reload proves the authoritative file has not changed.

## Impact

- Affected code: `src/infrastructure/workers/document-sync-worker-runtime.ts`, worker-backed repository behavior in `src/infrastructure/modeling/worker-backed-document-repository.ts`, and any shared document equality helper needed to avoid ad hoc comparison.
- Affected tests: logic-lane `bun:test` coverage around the document sync worker and repository load seam, following `docs/testing.md`.
- Runtime impact: reloads of unchanged filesystem-linked documents avoid unnecessary repository mutation and downstream geometry rebuild work while still reading the authoritative file first.
- No UI, file format, or OpenCascade API changes are intended.
