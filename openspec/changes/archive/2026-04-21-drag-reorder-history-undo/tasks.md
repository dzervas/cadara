## 1. Modeling Contracts

- [x] 1.1 Add a generic document-history reorder request/response contract using durable sketch/feature history item identities and nullable insertion anchors.
- [x] 1.2 Add runtime-schema validation for the new reorder contract, including missing moved-item and missing-anchor rejection cases.
- [x] 1.3 Extend modeling adapter and service interfaces with a document-history reorder method while preserving existing feature-only reorder compatibility.
- [x] 1.4 Add operation-history entry creation, parsing, serialization, and replay for mixed sketch/feature document-history reorders.

## 2. Modeling Implementations

- [x] 2.1 Implement accepted, rejected, and conflict behavior for document-history reorders in the mock adapter.
- [x] 2.2 Implement accepted, rejected, conflict, and rebuild behavior for document-history reorders in the OCC adapter.
- [x] 2.3 Ensure authored document `historyOrder` and target-based document cursors remain valid after accepted reorders.
- [x] 2.4 Add modeling tests for moving sketches across features, moving features across sketches, invalid anchors, cursor target preservation, and replay after refresh.

## 3. Workbench Undo/Redo

- [x] 3.1 Add a workbench undo-entry kind that stores previous and next document-history order snapshots for accepted reorders.
- [x] 3.2 Apply reorder undo and redo through the modeling service, moving entries between undo/redo stacks only after accepted results.
- [x] 3.3 Preserve sketch-local undo/redo priority while sketch edit mode is active.
- [x] 3.4 Add workbench history tests for accepted reorder undo, accepted reorder redo, rejected restoration, and sketch-mode priority.

## 4. Timeline Interaction

- [x] 4.1 Add pointer drag state to timeline history items with a threshold that preserves click, double-click, tooltip, and context-menu behavior.
- [x] 4.2 Resolve item drop targets to durable document-history insertion anchors and ignore no-op drops.
- [x] 4.3 Disable reorder commits while cursor mutations, reorder mutations, or follow-up snapshot refreshes are pending.
- [x] 4.4 Wire accepted item drag drops to the workbench reorder callback without moving the document cursor.
- [x] 4.5 Add timeline rendering and interaction tests for feature reorder, sketch reorder, no-op drops, pending-state disablement, and preserved normal actions.

## 5. Verification

- [x] 5.1 Run `openspec validate drag-reorder-history-undo --strict`.
- [x] 5.2 Run `bun run test`.
- [x] 5.3 Run `bun run lint`.
- [x] 5.4 Run `bun run build`.
