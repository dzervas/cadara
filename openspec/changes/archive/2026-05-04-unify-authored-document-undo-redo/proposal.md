## Why

Undo and redo currently multiplex three different mechanisms: sketch-session cursor movement, a workbench-local React stack for a few mutations, and document history cursor rollback. That does not match the user expectation of "revert whatever I just did," and it spreads history ownership across UI, runtime, and modeling seams instead of giving one durable owner responsibility for document-changing actions.

## What Changes

- Replace mixed undo ownership with one dedicated durable undo/redo coordination path that operates on repository-backed document history rather than workbench-local inverse stacks.
- Keep document timeline cursor movement as a separate CAD rollback/navigation tool instead of treating it as the fallback implementation of Undo and Redo.
- Route durable document mutations such as variable edits, durable renames, committed sketch/feature mutations, deletions, and history reorders through repository-backed undo grouping so they can be reverted and reapplied consistently.
- Extend the editor/runtime architecture so active sketch editing participates through the same durable history substrate instead of a separate user-visible undo model.
- Require the undo orchestration logic to live behind its own application/repository seam so toolbar code, shortcuts, workbench controllers, and editor runtime do not each grow private history logic.
- Preserve the boundary that Automerge implementation details remain internal to repository/infrastructure code; UI, hooks, and modeling consumers continue to depend on plain contracts and dedicated history ports only.
- **BREAKING** Remove the current workbench-local undo stack semantics and the current behavior where toolbar Undo/Redo falls through to document cursor rollback.

## Capabilities

### New Capabilities
- `durable-document-history`: Defines the dedicated repository-backed undo/redo substrate, history grouping model, and application-facing history coordination boundary for durable and draft document edits.

### Modified Capabilities
- `history-undo-redo`: Undo/redo behavior changes from mixed sketch-local/workbench-local/cursor fallback ownership to one durable history coordinator, while timeline cursor rollback remains a separate action.
- `document-repository`: Repository behavior changes so local persistence owns durable undo/redo state and draft-edit history on top of internal Automerge storage without leaking Automerge details.
- `document-repository-sync`: Local peer sync requirements change so authored-document sync remains shared while repository-local undo metadata and active draft history do not become cross-peer shared history by accident.
- `editor-runtime-orchestration`: Runtime sequencing changes so undo/redo requests are dispatched through a dedicated history service/module instead of being split between sketch reducers, workbench hook state, and document cursor effects.
- `authored-model-document`: Clarify that the canonical authored document remains user-authored CAD state only and does not absorb repository-local undo ledger or draft-history bookkeeping.

## Impact

- Affected code areas: `src/app/workbench/controllers/use-workbench-history.ts`, editor state-machine history routing, workbench document-owner orchestration, document repository interfaces/implementations, modeling-service mutation entry points, and sketch-session integration seams.
- Affected systems: undo/redo UX, sketch edit flows, durable document persistence, local peer sync boundaries, runtime sequencing, and document mutation ownership.
- Dependencies: no new product dependency is required, but repository and runtime ports will grow dedicated durable-history contracts.
- Expected outcome: one authoritative undo/redo owner, fewer ad hoc inverse stacks, clearer layering, and behavior that tracks persisted document mutations rather than UI-local bookkeeping.
