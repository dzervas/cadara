## Why

Users need CAD documents edited in the browser to stay connected to a local file that the browser can write directly through a retained file handle, rather than repeatedly exporting downloads or prompting a save-as flow. The app also needs to keep Automerge document normalization and local file writes off the main thread so document changes do not block the workbench UI.

## What Changes

- Add File System Access API support for opening an existing local `.cadara`/JSON document and binding the active document to that file for subsequent direct writes through the file handle.
- Add File System Access API support for choosing a local save location once, writing the active document there, and binding subsequent sync writes directly to that same file handle without additional save-as/download prompts.
- Persist the local file binding so the app remembers the previously selected file after refresh or browser restart where the browser supports storing file handles.
- Add a dedicated document sync Web Worker that observes Automerge-backed authored document changes, normalizes them into the persisted authored-document JSON shape, and writes them to the bound file handle when one exists.
- **BREAKING**: Remove the runtime document-normalization path from the main thread; the main thread must treat normalized file persistence as an asynchronous worker responsibility.
- Keep existing Import/Export behavior as explicit one-shot file operations, separate from Open local file and Save local file.
- Surface visible sync status and failures without silently replacing, clearing, or overwriting user documents.

## Capabilities

### New Capabilities

- `local-file-system-document-sync`: Defines File System Access API document binding, worker-owned Automerge-to-authored-document normalization, background local file writes, permission handling, and sync failure behavior.

### Modified Capabilities

- `workbench-document-file-menu`: Adds Open local file and Save local file actions to the existing document file menu contract.

## Impact

- Affected UI: `src/components/layout/document-file-menu.tsx`, `src/components/layout/document-file-menu-model.ts`, toolbar wiring, and visible workbench notification/status surfaces.
- Affected document runtime: `DocumentRepository`, Automerge handle subscription/change metadata, authored document validation/migration, and active document restore flow.
- Affected worker/runtime boundary: new dedicated document sync worker, message protocol, cancellation/stale-write handling, and worker tests.
- Affected browser APIs: File System Access API (`showOpenFilePicker`, `showSaveFilePicker`, `FileSystemFileHandle`, `FileSystemWritableFileStream` direct writes), structured-clone/IndexedDB storage of file handles, with explicit unsupported-browser handling.
- Affected persistence behavior: local IndexedDB-backed Automerge remains the canonical live document source, while a user-bound filesystem file receives normalized serialized snapshots asynchronously.
- Affected tests: `bun:test` coverage for menu items, file picker adapters, worker normalization/write sequencing, permission failures, unsupported API behavior, and ensuring main-thread code no longer performs sync normalization.
