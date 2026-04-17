## Context

The workbench has two different concepts that must stay separate:

- Timeline rollback is represented by committed document history plus `DocumentSnapshot.document.cursor`.
- Sketch edit undo is represented by `SketchSessionState.fullDefinition` plus `SketchSessionState.historyCursor`.

The toolbar already defines `undo` and `redo` tools. Active sketch sessions can use the sketch-local cursor as undo/redo because that cursor controls the uncommitted sketch draft. Outside sketch mode, toolbar Undo/Redo must use a command stack; moving the document timeline cursor is rollback, not command undo.

## Goals / Non-Goals

**Goals:**
- Make toolbar Undo and Redo work in sketch edit mode.
- Make toolbar Undo and Redo work for supported idle part-mode commands, starting with document variable edits.
- Reuse the sketch-local cursor contract for active sketch drafts.
- Keep document timeline rollback available only through timeline cursor interactions.
- Surface disabled/no-op behavior at history boundaries.

**Non-Goals:**
- No feature-form draft undo stack in V1.
- No universal inverse framework for every modeling mutation in V1.
- No full document snapshot restore stack.
- No change to the modeling contract schema.

## Decisions

### Use sketch cursor movement only inside active sketch sessions

Undo and redo move the active sketch history cursor by one valid authored item while a sketch session is active:

```
fullDefinition:  [Line 1] [Line 2] [Dimension 1]
cursor:                    ^
undo -> cursor at Line 1
redo -> cursor at Dimension 1
```

Rationale: within an open sketch, the sketch cursor is the draft history mechanism and already controls visible entities, constraints, and dimensions.

Alternative considered:
- Full sketch snapshot restore: rejected because the sketch session already has cursor-based draft history.

### Use a command stack outside sketch mode

Outside sketch mode, toolbar Undo and Redo use explicit inverse command records. For V1, document variable edits push an undo record containing the previous and next variable name/value. Undo applies the previous value; redo reapplies the next value.

Rationale: variable edits do not belong to the document timeline cursor. Moving the timeline cursor does not undo a variable edit and can unexpectedly roll back features.

Alternatives considered:
- Document timeline cursor rollback: rejected for toolbar Undo/Redo because it changes applied model history rather than reverting the last command.
- Universal inverse modeling framework: deferred because each mutation kind needs a carefully designed inverse and validation strategy.
- Snapshot restore: rejected because it would create a second durability model beside authored operations and repository persistence.

### Route history commands by owner

Sketch undo/redo stays in the editor runtime because active sketch session state is editor-owned. Direct workbench mutations such as variable edits currently occur in `CadWorkbench`, so their undo entries are owned at the same workbench boundary.

Rationale: this keeps changes local to the owners of the state being undone and avoids pretending document timeline rollback is general command undo.

### Keep timeline rollback separate

Toolbar Undo does not move the document timeline cursor. Timeline rollback remains available through the bottom timeline handle and preserves its existing after-cursor item behavior.

## Risks / Trade-offs

- Boundary behavior may feel inert if the toolbar does not expose disabled state clearly -> derive `canUndo` and `canRedo` from the active sketch or command-stack context and disable unavailable controls.
- Undoing a command can conflict with peer/repository updates -> apply inverse commands against the current snapshot revision and report diagnostics through the existing workbench feedback path.
- Feature-form draft undo later could conflict with toolbar expectations -> keep V1 context rules explicit so draft undo can be introduced as a separate mode-specific stack.
- Only variable edits are supported outside sketch mode in V1 -> keep unsupported mutations from pushing undo entries until their inverse semantics are designed.

## Migration Plan

No data migration is expected. Existing documents continue to load normally. The toolbar history stack starts empty for each workbench session.

## Open Questions

- Which additional modeling mutations should get inverse command entries after variable edits?
