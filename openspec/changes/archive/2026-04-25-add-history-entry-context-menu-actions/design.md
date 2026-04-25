## Context

The committed document history UI already renders both sketch and feature entries in [src/components/layout/feature-timeline-bar.tsx](/app/src/components/layout/feature-timeline-bar.tsx), and those entries already participate in selection, double-click reopen, drag reorder, and context-menu presentation. The remaining gap is not a new modeling capability; it is a contract and wiring problem around which menu actions are always available, which ones are feature-only, and how cursor-tail navigation should behave from the same menu surface.

The current history bar already has the primitives needed for this work:
- `onReopenTarget` is the existing reopen path used by double-click.
- `onCursorRequested` is the existing editor-owned document cursor request path.
- `getDocumentHistoryCursorForIndex(...)` already resolves durable cursor targets from authored history order.

## Goals / Non-Goals

**Goals:**
- Make committed sketch and feature history rows expose one predictable context-menu action set.
- Route context-menu `Edit` through the same reopen flow and rollback lifecycle as double-click.
- Add `Roll To End` without introducing a separate cursor API or item-kind-specific code path.
- Preserve existing selection, reorder, tooltip, and suppress behavior.

**Non-Goals:**
- Change sketch-local edit history behavior while a sketch session is active.
- Introduce new modeling-service mutation types for history-menu actions.
- Redesign rename or delete flows beyond keeping them present in the finalized menu contract.

## Decisions

### Build history-row menus from shared document-history item state

Committed document history menu entries should be derived from the same `DocumentHistoryItemRecord` data for sketch and feature items, with feature-only extensions layered on top. The common action set is `Edit`, `Rename`, `Roll History Here`, `Roll To End`, and `Delete`; `Suppress` remains feature-only.

This keeps sketch and feature rows aligned without duplicating separate menu implementations or scattering availability rules across item render branches.

Alternative considered: add separate sketch-history and feature-history menu builders. Rejected because the committed document history already uses one mixed item model, and splitting the menu logic would make parity harder to preserve.

### Reuse existing reopen and cursor request paths

`Edit` should call the same reopen handler used by double-click so feature reentry, sketch reentry, rollback-before-edit, and restore-after-edit stay owned by the existing in-place editing flow. `Roll History Here` should keep using the existing history-index-to-cursor helper, and `Roll To End` should request the cursor for the current authored-history tail through that same editor-owned path.

This avoids creating a second set of edit or cursor orchestration rules that could drift from the existing double-click behavior.

Alternative considered: introduce dedicated `editFromMenu` or `moveCursorToLatest` mutation types. Rejected because the runtime already has stable reopen and cursor-request entry points, and duplicating them would increase risk without expanding capability.

### Derive `Roll To End` availability from the rendered history model

The menu should disable `Roll To End` when the current document cursor already targets the latest authored history position. That state can be derived from the rendered history items and current cursor index, alongside the existing pending-state disablement for cursor mutations.

This keeps the menu contract local to the workbench history presentation layer and avoids adding extra durable flags to the modeling snapshot.

Alternative considered: ask the modeling layer for an explicit `isAtLatest` flag. Rejected because the history presentation already knows the current cursor index and the authored tail position.

## Risks / Trade-offs

- [Menu action parity could drift from double-click reopen behavior] -> Mitigation: route `Edit` directly through the existing reopen callback and add tests that treat menu edit and double-click as equivalent entrypoints.
- [Tail-navigation availability can become stale during pending cursor refresh] -> Mitigation: keep `Roll To End` gated by the same pending cursor disablement already used by other cursor actions.
- [Adding actions to dense history controls can interfere with drag and click behavior] -> Mitigation: keep the existing context-menu wrapper and drag-threshold behavior unchanged, and add focused interaction coverage around menu open and close paths.
