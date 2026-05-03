## Context

Undo and redo currently cross three ownership models:

- sketch editing uses in-session cursor movement over `SketchSessionState`
- workbench controllers keep a React-local inverse stack for a narrow set of durable mutations
- document-level fallback treats timeline cursor rollback as undo/redo

That split violates the repo's layering intent. History logic is duplicated across editor reducers, workbench hooks, and modeling-service call sites, while the durable document already persists through an internal Automerge-backed repository. At the same time, the canonical `AuthoredModelDocument` contract is deliberately limited to user-authored CAD state and should not become a dumping ground for repository-local or editor-local bookkeeping.

The codebase also already has local peer synchronization and repository-head freshness checks. Any durable undo design therefore has to answer two architectural questions explicitly:

1. where undo state lives without leaking Automerge into UI/runtime consumers
2. whether that undo state is peer-shared authored state or local repository metadata

## Goals / Non-Goals

**Goals:**
- Make undo/redo behave like "revert or reapply the last document-changing action" instead of timeline cursor navigation.
- Give undo/redo one dedicated owner module/service instead of distributing logic across hooks, reducers, and ad hoc inverse stacks.
- Keep Automerge details behind repository boundaries and expose only plain history contracts to application/runtime code.
- Keep `AuthoredModelDocument` canonical for user-authored CAD data while allowing repository-backed local durable history to persist across refreshes.
- Let active draft editing flows participate in the same durable history substrate so sketch editing does not remain a separate user-visible undo model.

**Non-Goals:**
- Defining collaborative multi-user undo semantics across peers beyond local-session safety.
- Making selection, hover, camera, or other non-durable UI state part of undo/redo.
- Exposing Automerge heads, handles, or transaction APIs to components, hooks, or reducer code.
- Solving every command-preview or transient form-edit behavior in one step if it does not represent a document-changing action.

## Decisions

### 1. Introduce a dedicated durable history module at the application boundary

The change will introduce a focused history coordination module in the application layer, with a narrow responsibility: resolve undo/redo requests, surface availability, and dispatch durable history operations through the authoritative repository/runtime owners.

Why:
- The current workbench hook is acting as both UI adapter and partial history owner.
- The editor runtime already sequences effects, but it should not absorb storage-specific durable history bookkeeping.
- A dedicated module keeps history policy in one place and lets toolbar actions, shortcuts, and command flows share the same seam.

Alternatives considered:
- Keep expanding `useWorkbenchHistory`: rejected because it preserves React-local ownership and makes history behavior depend on mounted UI state.
- Move all history logic into editor reducers: rejected because repository-backed persistence and local-history storage are not `core` concerns.

### 2. Keep repository-backed undo state outside `AuthoredModelDocument`

The canonical authored document remains user-authored CAD state only. Durable undo metadata, redo metadata, local history grouping records, and draft-session bookkeeping will live as repository-owned local persistence state on top of the Automerge substrate, not as new authored-document fields.

Why:
- Undo stack state is not authored CAD input; it is repository-local operational metadata.
- Persisting stack bookkeeping in `AuthoredModelDocument` would pollute the canonical transport/persistence contract and create unnecessary merge semantics for data the user did not author directly.
- Keeping it repository-local allows the app to preserve undo across refreshes while still honoring the authored-document boundary.

Alternatives considered:
- Store undo stack arrays in `AuthoredModelDocument`: rejected because it makes authored data carry local operational state and complicates sync/merge semantics.
- Keep undo stack entirely in memory: rejected because it breaks the goal of Automerge-backed durable undo and still loses state on refresh.

### 3. Use repository-backed history groups rather than workbench-local inverse commands

Undoable actions will be recorded as durable history groups on top of accepted repository-backed document mutations. Undo and redo will move through those groups by asking the repository/history seam to restore the previous or next local durable group, instead of reconstructing inverses in controller code.

Why:
- It matches the user request that undo act on top of the Automerge-backed durable document state.
- It removes narrow, mutation-specific inverse stacks from workbench hooks.
- It scales to document rename, variable edits, reorder actions, deletes, and future durable operations without bespoke inverse payload types scattered through UI code.

Alternatives considered:
- Continue adding per-mutation inverse payloads: rejected because it does not unify ownership and turns every new mutation into hand-written undo bookkeeping.
- Treat document cursor rollback as durable undo: rejected because rollback is a modeling/navigation concept, not "undo my last action."

### 4. Treat timeline cursor rollback as a separate explicit action

Timeline rollback remains a dedicated document-history action. Undo/redo will no longer fall through to document cursor movement when no local workbench stack entry exists.

Why:
- The current behavior is the root of the user-visible inconsistency.
- Cursor rollback changes what portion of authored history is applied; undo/redo should instead target the user's last grouped mutation.

Alternatives considered:
- Keep cursor rollback as last-resort undo: rejected because it preserves the exact mismatch this change is trying to remove.

### 5. Move active draft edit history onto the same durable substrate

The user-visible undo model should not split between "draft sketch undo" and "document undo." Active draft edit sessions that represent document-changing authoring work will use repository-backed local draft history so undo/redo remains one coherent feature during sketch editing and similar durable edit workflows.

Why:
- Without this, the proposal would only fix durable committed actions and leave the highest-frequency editing flow on a separate model.
- Draft history still needs to remain local and non-authored, which fits repository-local metadata better than authored-document fields.

Alternatives considered:
- Leave sketch draft history separate forever: rejected because it preserves the cross-model inconsistency the user called out.
- Persist draft sessions directly in authored-document fields: rejected because draft bookkeeping is not canonical authored CAD state.

### 6. Keep local durable history local; do not silently peer-sync it

Same-origin peer synchronization will continue to sync authored CAD state. Repository-local durable undo metadata and active draft history remain local to the editing context and are not treated as shared authored history.

Why:
- Shared undo history across peers would create ambiguous "who owns the last change" semantics.
- The current repository sync capability is about converging authored document state, not sharing an operational local undo ledger.

Alternatives considered:
- Sync undo groups across peers automatically: rejected because it creates collaborative undo semantics this change is not prepared to define.

## Risks / Trade-offs

- [Draft-session persistence broadens scope] → Limit the first implementation to document-changing draft workflows and keep selection/preview/tool-local state out of the durable history substrate.
- [Repository-local history can drift from authored mutations if grouping is ad hoc] → Require durable mutation entry points to declare history grouping through one application/repository seam instead of optional controller-side bookkeeping.
- [Automerge-backed history restoration may be more complex than inverse replay] → Hide the mechanism behind repository ports so implementation can use heads, snapshots, or internal metadata without changing consumers.
- [Local-only undo may surprise users in multi-tab editing] → Specify clearly that authored document changes sync across tabs, but local undo ledgers and active draft sessions do not.
- [Migration from current stacks can leave duplicate behavior temporarily] → Remove workbench-local inverse stacks and cursor-fallback undo as part of the same implementation slice rather than layering the new coordinator on top.

## Migration Plan

1. Add the dedicated durable history contracts and coordinator module without wiring old entrypoints away yet.
2. Extend the repository boundary to persist local durable history metadata and local draft-session history on top of internal Automerge storage.
3. Route toolbar and shortcut undo/redo through the new coordinator and remove workbench-local inverse stacks.
4. Retain explicit document timeline rollback commands, but decouple them from Undo/Redo semantics and availability.
5. Move sketch-session and other covered draft-edit flows onto repository-backed local history, then delete the now-competing user-visible undo ownership paths.

Rollback strategy:
- If the implementation proves unstable, disable the new coordinator entrypoints and restore explicit timeline actions while keeping repository and authored-document contracts backward-compatible.
- Because local undo metadata is repository-owned rather than authored-document state, rollback does not require authored-document schema migration.

## Open Questions

- Should the first implementation cover all document-changing draft edit workflows, or only sketch editing plus already-durable workbench mutations?
- Does the repository expose history groups as opaque IDs/labels only, or is richer inspection needed for future UI such as an undo history panel?
- Is a single repository document envelope sufficient for local draft/history metadata, or should local undo state live in a separate repository-owned companion document to simplify sync exclusion?
