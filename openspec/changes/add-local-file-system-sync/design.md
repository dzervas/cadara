## Context

The app already has a `DocumentRepository` boundary that keeps Automerge and IndexedDB implementation details away from UI, editor, viewport, and kernel consumers. The current repository implementation still runs in the main thread, and the modeling service normalizes collaborative authored documents before passing them to the OCC restore path. The existing file menu supports New, Import, and Export as one-shot document operations.

The requested behavior adds a different file workflow: a user-granted local file handle can become the live sync target for the active authored document and can be written directly through the File System Access API. Browser file pickers must stay on the main thread because they require a user gesture, but ongoing Automerge document observation, authored-document normalization, and direct filesystem writes should be asynchronous worker responsibilities.

## Goals / Non-Goals

**Goals:**

- Add Open local file and Save local file actions that bind the active document to a user-selected filesystem file.
- Keep Import and Export as explicit one-shot operations that do not create a live sync binding.
- Move Automerge-to-authored-document normalization out of the main thread and into a dedicated document sync worker.
- Have the same worker write normalized authored-document JSON directly to the bound `FileSystemFileHandle` after accepted document changes, without download or repeated save-as flows.
- Remember the last successful local file binding across refresh or browser restart when the browser can persist `FileSystemFileHandle` values.
- Preserve existing repository freshness, peer update, validation, migration, and explicit failure semantics.
- Keep the local document file format as `.cadara` JSON with `application/json` MIME for the current implementation.
- Surface unsupported browser APIs, permission failures, invalid files, and write failures through existing visible notification/error paths.

**Non-Goals:**

- Adding cloud storage, remote collaboration, or non-browser native filesystem integrations.
- Automatically writing to arbitrary paths without a user-granted `FileSystemFileHandle`.
- Replacing the authored model document schema or persisting render/presentation state.
- Changing OCC rebuild behavior except for consuming normalized worker results instead of main-thread normalization.
- Guaranteeing write permission survives refresh; restored bindings must still verify or re-request permission before writing.

## Decisions

1. Introduce a dedicated document sync worker behind the existing repository boundary.

   Add a worker such as `src/domain/modeling/document-sync.worker.ts` with a typed client in the main thread. The worker owns the Automerge repository integration, local peer notifications, validation/migration, collaborative normalization, and local-file sync queue. Main-thread consumers keep using `DocumentRepository`/modeling service methods and receive plain normalized `AuthoredModelDocument` records plus metadata. Alternative considered: keep Automerge in the main thread and only offload file writes. That would reduce work but would leave the normalization path that the change explicitly removes.

2. Keep file picker prompts in UI/main-thread adapters, then transfer handles to the sync worker.

   `showOpenFilePicker` and `showSaveFilePicker` must be invoked from menu handlers in response to user actions and should use picker options for `.cadara` files with `application/json` content. After a file is selected, the main thread reads the selected file once for validation/open flow or asks the worker to read it through the transferred handle, then sends the `FileSystemFileHandle` to the worker as the active sync binding. Alternative considered: hidden `<input type="file">` for Open local file. That cannot provide a writable handle, so it cannot support ongoing sync.

3. Treat Open local file as replace-and-bind, and Save local file as write-and-bind.

   Open local file validates the selected `.cadara`/JSON authored document, replaces the active document through the same modeling service import/restore path, writes that normalized document into the Automerge repository, and binds future worker sync writes directly to the opened handle. Save local file asks for a destination once, writes the current normalized authored document to that handle, and binds future worker sync writes directly to the same file without later save-as prompts. Alternative considered: Open local file only imports the file and asks separately to enable autosave. The requested menu item says opening this way automatically syncs, so binding should be immediate after successful open.

4. Normalize once in the worker and fan out the result.

   The worker should expose a normalization result containing the normalized authored document, merge diagnostics, repository heads, and sync sequence metadata. That result is used both for modeling-service restore notifications and for writing stable JSON to the bound file. Main-thread code must remove direct calls to collaborative authored-document normalization and should only act on worker-normalized results. Alternative considered: duplicate normalization in worker for file sync and main thread for modeling restore. That risks divergent diagnostics and defeats the main-thread removal requirement.

5. Use a serialized write queue keyed by document binding.

   Filesystem writes should be ordered by repository heads or a monotonic sync sequence. If document changes arrive while a write is in flight, the worker should coalesce intermediate states and write the latest normalized document after the current write completes. Writes must use `FileSystemFileHandle.createWritable()`, write a complete JSON payload to the resulting `FileSystemWritableFileStream`, and close it atomically from the API perspective. Alternative considered: write every repository event immediately. That can backlog the worker during rapid modeling mutations and increases the chance of stale writes finishing last.

6. Keep sync failures non-destructive.

   If the API is unsupported, the selected file is invalid, permission cannot be regained, or a direct handle write fails, the app must keep the active Automerge-backed document unchanged and report the failure. When write permission is lost for an existing binding, the worker should ask the main thread to re-request write permission for the bound handle and resume sync after permission is granted; if the browser requires a user gesture, the workbench should show a visible permission action instead of silently pausing. A failed sync must not reset the repository or overwrite the local file with an empty document. Alternative considered: falling back to download export when Save local file cannot bind. That is acceptable as a separate Export action, but Save local file should clearly report that live sync is unavailable.

7. Persist local file bindings separately from the authored document.

   Store the active document's `FileSystemFileHandle` and minimal binding metadata in an IndexedDB-backed binding store after a successful Open local file or Save local file. On startup, load that binding, hand the restored handle to the document sync worker, verify read/write permission before writing, and re-request permission if needed. Do not store the handle inside the authored model document or Automerge payload, because it is browser-local capability state rather than portable CAD document content. Alternative considered: keep bindings only in memory. That is simpler, but the app would forget the selected file on refresh, which does not match the desired workflow.

## Risks / Trade-offs

- Worker repository migration is larger than adding file writes alone -> Keep the public `DocumentRepository` contract stable and add a worker-backed implementation behind it while retaining memory/direct implementations for tests.
- File System Access API availability is limited by browser and secure-context support -> Gate menu actions or show explicit unsupported messages and keep Import/Export available everywhere.
- `FileSystemFileHandle` permission can be revoked between writes -> Re-request write permission for the bound handle, resume after grant, and show a visible reconnect action when the browser requires user activation for the prompt.
- Persisted file handles may be unavailable in some browser/test runtimes -> Feature-detect handle storage, report when persistent binding restore is unavailable, and keep Open/Save local file usable for the current session.
- Restored handles may lack write permission after refresh -> Re-request permission before autosync writes and show a visible continuation action if the browser requires user activation.
- Rapid document changes can race with file writes -> Serialize writes in the worker, coalesce pending writes by document ID, and ignore stale completion messages on the main thread.
- Worker failures could block document restore notifications -> Report structured worker errors through existing application error paths and fall back to a clear read-only/import/export state rather than silent main-thread normalization.

## Migration Plan

1. Add menu model entries and UI handlers for Open local file and Save local file without changing Import/Export semantics.
2. Add File System Access adapter functions for feature detection, picker calls, file reads, writable creation, permission checks, persistent handle storage, and deterministic authored-document JSON serialization.
3. Add typed document sync worker protocol and client tests covering load, mutate, subscribe, normalize, bind file handle, write, and failure messages.
4. Move IndexedDB Automerge repository operations and collaborative authored-document normalization into the worker-backed repository path.
5. Remove main-thread collaborative document normalization calls from the modeling service; consume only worker-normalized documents and diagnostics.
6. Wire Open local file and Save local file through the modeling service/repository so successful operations bind the worker sync target and persist the binding metadata.
7. Restore any persisted file binding during startup, verify or re-request permission, and resume sync after permission is granted.
8. Add status/notification handling for unsupported API, persistent binding unavailable, permission re-request, permission denied, invalid document, synced, syncing, and sync failed states.

Rollback can keep the existing Import/Export menu items and direct/memory repository tests intact while disabling the worker-backed local-file binding path behind feature detection.

## Open Questions

None.
