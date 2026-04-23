## 1. Modeling Contract

- [x] 1.1 Add a generic deletion target request/response contract for supported document history items and durable part/object targets.
- [x] 1.2 Add runtime schemas and validation coverage for accepted targets, unsupported targets, malformed payloads, and stale revision responses.
- [x] 1.3 Add modeling service API wiring that normalizes caller input, calls the adapter, and maps accepted/rejected/conflict results consistently with existing mutations.

## 2. Domain Deletion Behavior

- [x] 2.1 Implement shared deletion planning for committed feature history items, committed sketch history items, and supported whole body/part targets.
- [x] 2.2 Update mock and OpenCascade adapters to apply generic deletion through authored document/history state, rebuild snapshots, return changed targets, and reject unsupported targets explicitly.
- [x] 2.3 Preserve or repair the document cursor after accepted deletions so the refreshed timeline never references a deleted item.
- [x] 2.4 Add domain tests for feature deletion, sketch deletion with downstream diagnostics, supported body/part deletion, unsupported target rejection, and stale revision conflicts.

## 3. Operation History

- [x] 3.1 Add a generic deletion operation-history entry, runtime validation, and serialization helpers.
- [x] 3.2 Replay generic deletion entries through the modeling boundary while preserving legacy `deleteFeature` replay compatibility.
- [x] 3.3 Add persistence/replay tests for feature history deletion, sketch history deletion, body/part deletion, invalid generic deletion entries, and legacy feature delete entries.

## 4. Workbench UI

- [x] 4.1 Replace feature-only delete workbench routing with one generic delete handler for Parts & Objects rows and document history rows.
- [x] 4.2 Update Parts & Objects context-menu Delete to call the generic modeling deletion path and surface accepted/rejected outcomes.
- [x] 4.3 Update the document history bar menu to expose Rename and Delete for supported committed sketch and feature items, including failed feature items.
- [x] 4.4 Preserve existing history bar selection, reopen, cursor, drag-reorder, tooltip, and feature Suppress placeholder behavior.

## 5. Verification

- [x] 5.1 Add or update component tests for sidebar Delete, history-bar Rename/Delete menu rows, failed feature Delete availability, keyboard context-menu access, and no reorder on menu open.
- [x] 5.2 Run `bun run test`.
- [x] 5.3 Run `bun run lint`.
- [x] 5.4 Run `bun run build`.
