## 1. File Menu and Browser File Access

- [ ] 1.1 Update the document file menu model, component props, and toolbar wiring to include Open local file and Save local file alongside New, Import, and Export.
- [ ] 1.2 Add browser File System Access adapter functions for support detection, `.cadara`/`application/json` open picker options, `.cadara`/`application/json` save picker options, permission checks, file reads, direct writable stream creation from `FileSystemFileHandle`, and cancel handling.
- [ ] 1.3 Add an IndexedDB-backed local file binding store for `FileSystemFileHandle` plus minimal binding metadata, with support detection and explicit unsupported-storage results.
- [ ] 1.4 Add deterministic authored-document JSON serialization shared by Save local file, worker sync writes, and existing `.cadara` export behavior where practical.
- [ ] 1.5 Add focused `bun:test` coverage for menu item order, handler routing, unsupported API reporting, picker cancellation, persistent handle storage support, and file extension/MIME options.

## 2. Document Sync Worker Protocol

- [ ] 2.1 Define typed document sync worker request/response messages for repository load, mutate, subscribe/change events, normalize result, restore persisted binding, bind file handle, write status, and structured failures.
- [ ] 2.2 Implement the document sync worker shell and main-thread client with request correlation, stale response rejection, subscription teardown, and explicit failure propagation.
- [ ] 2.3 Add tests for worker request ordering, subscription disposal, structured failure messages, and stale write/status message handling.

## 3. Worker-Backed Repository and Normalization

- [ ] 3.1 Move the IndexedDB Automerge repository operations needed by the browser `DocumentRepository` path behind the document sync worker client while keeping memory/direct repository implementations for tests.
- [ ] 3.2 Move collaborative authored-document normalization into worker-owned code and return normalized authored documents, diagnostics, repository heads, and source metadata to the main thread.
- [ ] 3.3 Remove the main-thread collaborative normalization path from the modeling service restore flow and consume only worker-normalized repository results before OCC restore.
- [ ] 3.4 Add tests proving repository load, local mutation, peer update, invalid merge diagnostics, and restore notifications still work through the worker-backed path.
- [ ] 3.5 Add tests or static coverage proving the modeling service no longer calls the main-thread Automerge-to-authored-document normalization path.

## 4. Local File Binding and Autosync

- [ ] 4.1 Implement Open local file as validate, normalize, replace active document, persist into Automerge repository, bind selected file handle, and report active sync status.
- [ ] 4.2 Implement Save local file as choose destination, write current normalized authored document, bind selected file handle, and report active sync status.
- [ ] 4.3 Persist successful Open local file and Save local file bindings outside the authored model document and restore the previous binding during startup when supported.
- [ ] 4.4 Implement worker-side file binding state and a per-document serialized/coalescing direct-write queue keyed by repository heads or monotonic sync sequence, using the retained file handle without download or repeated save-as prompts.
- [ ] 4.5 Add worker-side write permission checks that re-request write permission when it is lost or when a restored binding lacks permission, resume autosync after grant, and mark sync failed without resetting the active document or clearing repository state when permission cannot be regained.
- [ ] 4.6 Add tests for successful open-and-bind, save-and-bind, restored binding after refresh, autosync after accepted changes, permission re-request after permission loss, restored-binding permission prompt, permission denied, write failure, and rapid-change write coalescing.

## 5. Status, Errors, and Existing File Actions

- [ ] 5.1 Surface visible workbench notifications or status messages for local sync active, restored binding, syncing, synced, unsupported browser, persistent binding unavailable, permission re-request/action required, permission denied, invalid file, and sync failed states.
- [ ] 5.2 Keep Import and Export as one-shot actions that do not create or replace a local filesystem sync binding.
- [ ] 5.3 Ensure file sync failures flow through existing error/reporting paths without swallowed exceptions or indefinite pending states.
- [ ] 5.4 Add tests proving Import/Export binding neutrality, direct autosync does not use download/export code paths, and visible failure/status behavior.

## 6. Verification

- [ ] 6.1 Run `bun run test` and address failures.
- [ ] 6.2 Run `bun run lint` and address failures.
- [ ] 6.3 Run `bun run build` and address failures.
