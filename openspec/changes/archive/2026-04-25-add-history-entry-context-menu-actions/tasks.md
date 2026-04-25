## 1. History Menu Actions

- [x] 1.1 Update committed document history menu construction so sketch and feature entries share `Edit`, `Rename`, `Roll History Here`, `Roll To End`, and `Delete`, while feature entries keep `Suppress`.
- [x] 1.2 Derive `Roll To End` enablement from the current document cursor and authored-history tail, and keep cursor actions disabled while a cursor mutation or refresh is pending.

## 2. Routing Parity

- [x] 2.1 Route context-menu `Edit` through the same reopen callback and rollback lifecycle already used by double-click for committed sketch and feature entries.
- [x] 2.2 Route `Roll History Here` and `Roll To End` through the existing editor-owned document cursor request path without introducing a second history-cursor mutation entrypoint.
- [x] 2.3 Preserve existing click selection, drag reorder, repair-tooltip, and context-menu-close behavior while the new history actions are present.

## 3. Verification

- [x] 3.1 Add or update timeline component tests covering sketch and feature menu contents, `Roll To End` disablement at the tail, and delete availability for errored features.
- [x] 3.2 Add or update workbench/editor interaction tests proving context-menu `Edit` matches double-click reopen behavior and that history cursor requests target the clicked entry or the latest tail as expected.
