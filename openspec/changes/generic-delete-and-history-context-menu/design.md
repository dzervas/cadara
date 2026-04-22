## Context

The workbench already has a shared `WorkbenchContextMenu` and sidebar rows already expose Rename, Delete, and Export. Rename for bodies, sketches, and features is backed by existing modeling mutations, but Parts & Objects Delete still reports a placeholder. The document history bar already renders committed sketches and features as shared history items, yet the destructive path is feature-specific (`deleteFeature`) and the menu only exposes Delete for some feature rows.

The modeling layer has durable identities for document history items (`sketch` and `feature`) and primitive refs such as bodies. It also has repository-backed mutations, operation-history persistence, and snapshot rebuild/refresh behavior. The missing piece is a generic deletion mutation that accepts a supported durable target and lets the modeling domain decide the correct authored document change.

## Goals / Non-Goals

**Goals:**
- Provide one workbench delete route for supported Parts & Objects rows and document history rows.
- Support deleting committed feature history items, committed sketch history items, and whole body/part rows without feature-kind-specific UI code.
- Persist accepted deletes through the existing repository and operation-history paths.
- Preserve current history bar selection, cursor, reorder, repair, and rename behavior while adding context-menu parity.

**Non-Goals:**
- Delete arbitrary topology sub-elements such as individual faces, edges, or vertices from Parts & Objects.
- Add a new confirmation dialog or recycle-bin model.
- Implement feature suppression; existing suppress placeholder behavior can remain separate.
- Redesign the context menu component or shortcut system.

## Decisions

### Use a generic delete target contract

Introduce a modeling mutation shaped around a shared deletion target, for example a document history item identity or supported primitive ref. The public workbench handler should call this generic mutation for Delete from sidebar and history-bar menus.

Rationale: UI code should not need to know whether a row is backed by an extrude, import, sketch, delete-solid feature, or future feature kind. The modeling boundary already owns durable identities, validation, repository commits, and rebuilds.

Alternative considered: keep `deleteFeature` and add `deleteSketch`, `deleteBody`, and future type-specific methods. That would duplicate stale-revision handling, operation-history wiring, snapshot refresh behavior, and menu branching.

### Keep deletion planning in the modeling domain

The modeling layer should resolve a delete target into the authored document mutation. Document history item deletion removes the referenced sketch or feature from authored history and history order. Body/part deletion should use a generic body removal plan owned by modeling code, which may internally reuse existing delete-solid authoring behavior if that is the smallest durable representation.

Rationale: resolution needs the current snapshot, ownership metadata, authored document order, cursor rules, and rebuild diagnostics. Keeping that in domain code prevents presentational components from guessing ownership.

Alternative considered: have the sidebar infer an owner feature and call `deleteFeature`. That is simple for some generated bodies but wrong for multi-body features, imported assets, and future body-producing operations.

### Preserve history item identity and cursor rules

Deleting a history item should update `historyOrder`, remove stale labels/references owned only by the deleted item, and move the document cursor when it references a deleted item. If the cursor remains valid, it should stay unchanged.

Rationale: the timeline and undo/redo logic already use history order and cursor helpers. Deletion should be another document mutation with the same rebuild and refresh semantics.

Alternative considered: leave the cursor untouched and rely on rebuild validation to repair it. That would surface avoidable invalid cursor diagnostics after a successful user action.

### Add one operation-history entry for generic deletion

Persist accepted generic deletes as a typed operation-history entry carrying the deletion target accepted by the modeling service. Existing `deleteFeature` history entries should continue to replay for compatibility, but new UI paths should emit the generic entry.

Rationale: operation history is a compatibility/replay representation of document mutations. A generic entry avoids extending history every time a new deletable history item or part type is added.

Alternative considered: translate generic deletes back into legacy type-specific entries during persistence. That keeps the schema stable for one case but recreates the per-type expansion this change is meant to avoid.

### Reuse `WorkbenchContextMenu` for history-bar parity

The document history bar should build menu entries from `DocumentHistoryItemRecord` rather than feature-only props. Feature-only actions such as Suppress can stay conditional, while Rename and Delete should be available for all supported document history items. Failed feature rows should still expose Delete so users can remove unrepaired authored items.

Rationale: the history bar already has focusable row controls and context-menu plumbing. The narrow fix is to generalize the item handler and menu data, not create a parallel menu.

Alternative considered: add an overflow button to each timeline item. That would increase visual noise in a dense CAD timeline and duplicate existing keyboard/right-click context-menu access.

## Risks / Trade-offs

- [Risk] Body/part deletion semantics can be ambiguous for bodies produced by multi-body or imported features. -> Mitigation: implement a deletion planner that accepts only unambiguous supported targets and rejects unsupported targets with diagnostics instead of guessing.
- [Risk] Generic operation-history entries require schema changes. -> Mitigation: keep legacy `deleteFeature` replay support and add focused migration/replay tests.
- [Risk] Deleting a sketch can invalidate downstream features. -> Mitigation: use the existing rebuild diagnostics path so later invalid references are reported rather than silently remapped.
- [Risk] Context-menu actions can interfere with timeline drag behavior. -> Mitigation: preserve the existing drag threshold and add tests proving right-click/keyboard menu opening does not commit reorder.
