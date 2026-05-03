## 1. Define the durable history seam

- [x] 1.1 Add dedicated durable-history contracts and module boundaries in the application/repository layers so undo/redo no longer depends on workbench-local stack types.
- [x] 1.2 Define the shared undo-context policy and availability rules for draft-edit history versus committed durable document history.
- [x] 1.3 Update authored-document and repository-facing validation/typing seams so repository-local undo metadata is kept out of the canonical authored document contract.

## 2. Build repository-backed durable history storage

- [x] 2.1 Extend the document repository boundary and implementations with plain undo/redo operations and local history availability queries.
- [x] 2.2 Persist local durable undo/redo metadata on top of the internal Automerge-backed repository substrate without exposing Automerge details to callers.
- [x] 2.3 Add repository-local draft-history persistence for covered document-changing edit sessions and ensure explicit draft cancellation clears that local history.
- [x] 2.4 Exclude repository-local undo metadata and draft-history state from peer-sync propagation while preserving authored document sync.

## 3. Route runtime and workbench through the dedicated history module

- [x] 3.1 Introduce the dedicated durable-history coordinator module and route toolbar plus shortcut undo/redo through it.
- [x] 3.2 Update editor/runtime integration so explicit document timeline rollback remains available as its own action and is no longer used as Undo/Redo fallback.
- [x] 3.3 Remove the current workbench-local undo entry types and inverse-stack ownership from workbench controllers once the dedicated history seam is wired.

## 4. Migrate covered edit flows and clean up old ownership paths

- [x] 4.1 Move variable edits, durable renames, deletes, sketch/feature commits, and history reorders onto durable history grouping instead of bespoke controller bookkeeping.
- [x] 4.2 Move sketch draft undo/redo onto repository-backed draft history so active sketch editing uses the shared durable undo model.
- [x] 4.3 Delete or simplify superseded sketch-local and workbench-local undo ownership code that remains only because of the old split history architecture.
- [x] 4.4 Add or update seam-appropriate coverage for repository durable history behavior, runtime/history routing, and local-sync exclusion of repository-local undo metadata.
