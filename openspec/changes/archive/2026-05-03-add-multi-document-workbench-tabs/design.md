## Context

The current workbench already has the beginnings of a tab system:
- `src/domain/workspace/workbench-tabs.ts` models tab order, active tab, rename, reorder, and `storageKind`
- `src/components/layout/document-tabs-bar.tsx` renders the strip, rename UI, and storage glyphs
- `src/infrastructure/persistence/local-storage-workbench-tabs-store.ts` persists tab metadata across reloads

But the actual document session is still singleton-scoped:
- `src/App.tsx` creates one `ModelingService`, one sketch solver, and one editor runtime
- `src/app/workbench/cad-workbench.tsx` explicitly leaves tab activation as a no-op until some future `switchDocument` seam exists
- the active tab is forced to mirror `modelingService.currentDocumentId`

That means the current tab strip is only UI state. It cannot change the Automerge-backed document, the editor/runtime snapshot, or the kernel rebuild target.

There is a second structural gap: the durable authored document contract has no document-level name field. Tab rename currently edits workbench metadata only, so there is nothing durable for a renamed tab to stay synchronized with after a true document switch or reload.

The repository and sync layers are already closer to the desired shape than the app shell:
- document repositories are keyed by `documentId`
- repository URL storage is keyed by `documentId`
- local-file bindings are keyed by `documentId`
- worker sync statuses are keyed by `documentId`

So the design problem is not “make persistence multi-document.” It is “compose a document-scoped active session at the application boundary and give the durable document contract a real name field.”

Assumptions:
- The existing editor runtime and modeling service contracts remain the authoritative document/session owners once instantiated for a specific `documentId`.
- `storageKind` remains a coarse location indicator only: `browser`, `filesystem`, or `cloud`. Transient sync health remains outside the tab indicator for this change.
- Existing workbench-tab `localStorage` payloads do not need migration. The change may replace them with the new canonical shape.

## Goals / Non-Goals

**Goals:**
- Make workbench tabs switch the active document session for real.
- Persist open tabs and the active tab across page reloads.
- Add a durable document name field so tab rename and document rename are the same operation.
- Keep local-file bindings, repository URLs, and sync indicators document-scoped.
- Route open-local-file and import-document flows into newly created tabs rather than replacing the currently active tab.
- Fit the implementation into the existing workbench ownership rules: application-owned composition, runtime-owned document state, shell-local presentation only.

**Non-Goals:**
- Cloud persistence or cloud-specific tab behavior beyond preserving `storageKind: 'cloud'` as a future-facing indicator.
- Concurrent mounting of multiple editor/modeling sessions at once.
- Preserving or migrating old workbench tab `localStorage` payloads.
- Introducing a generic singleton `modelingService.switchDocument()` escape hatch.
- Redesigning unrelated workbench flows such as history, import review UX, or toolbar layout.

## Decisions

### Decision: Active document switching will remount a document-scoped session host

The workbench will compose an application-owned active-document session host keyed by the active tab's `documentId`. That host is responsible for creating:
- a `ModelingService` for that `documentId`
- a sketch solver for that `documentId`
- the editor/runtime provider tree bound to that service

Changing tabs will change the active host key, which will naturally:
- load or restore the target authored document from the repository
- rebuild a fresh snapshot for that `documentId`
- reset runtime/editor state through the existing document bootstrap path

Why this approach:
- It matches the existing ownership model: app composition owns service instantiation; runtime owns active document state after boot.
- It avoids mutating a singleton service in place, which would create hidden state handoff problems across the editor runtime, subscriptions, solver correlation, and local-file sync listeners.
- It keeps `documentId` session scoping explicit in React composition instead of implicit inside service internals.

Alternatives considered:
- Add `modelingService.switchDocument(documentId)`.
  Rejected because it pushes app-composition concerns into a long-lived domain/service singleton and creates cross-session cleanup hazards.
- Keep one service instance and patch the editor snapshot after switching repository URLs.
  Rejected because it reintroduces shell-local repair logic instead of explicit session ownership.

### Decision: Document name becomes a durable authored-document field

The canonical authored model document will gain a document-level `name` field. The workbench tab title is a view of that field, not an independent source of truth.

Effects:
- Renaming a tab dispatches a real document rename mutation.
- Loading a document seeds the tab title from the durable document name.
- Export/import/open-local flows preserve the durable name as part of the authored document.

Why this approach:
- It eliminates the current UI-only title metadata split.
- It makes reloads, tab switches, file opens, and future sync features converge on one durable name.
- It keeps naming in the modeling/authored boundary where persistence already lives.

Alternatives considered:
- Keep tab titles purely in workbench `localStorage`.
  Rejected because the title would drift from the actual document after reload, tab switching, or future peer sync.
- Derive the tab title from the local file name only.
  Rejected because browser-only documents and imported documents also need stable names, and local file binding is not the canonical document identity.

### Decision: File open/import create new tabs and activate them

Whole-document flows that introduce a different authored document will create a new tab first, then activate it, then mount the new document-scoped session for that `documentId`.

This applies to:
- open local file
- import authored `.cadara` / JSON document

Why this approach:
- It matches the user’s requested multi-file workflow.
- It preserves the currently active document instead of replacing it out from under the user.
- It aligns with the tab/session model: a different authored document means a different document session.

Alternatives considered:
- Reuse the current tab and replace its document basis.
  Rejected because that preserves the single-file mental model the change is meant to remove.

### Decision: Tab persistence remains shell/application metadata, not durable document state

The workbench will continue to persist:
- open tab order
- active tab
- tab-local display metadata needed before a document session finishes loading

But it will not persist that metadata inside the authored document itself.

Why this approach:
- Open-tab arrangement is workspace/UI state, not document state.
- The authored document spec already excludes presentation/workbench state.
- Document-scoped storage concerns such as repository URL and file binding already live in dedicated stores keyed by `documentId`.

Alternatives considered:
- Store tab order inside authored documents.
  Rejected because one document should not become the owner of a multi-document workspace layout.

### Decision: `storageKind` stays derived from document-scoped persistence state

The tab indicator will keep using the existing `storageKind` model and derive it from document-scoped persistence/binding state:
- `browser`: repository-backed in browser storage only
- `filesystem`: bound to a local file handle
- `cloud`: reserved for future remote-backed documents

This change does not overload the tab glyph with transient sync phases such as syncing, failed, or permission-required.

Why this approach:
- It preserves the current UI contract the user chose.
- It avoids collapsing “where the document lives” with “what the sync worker is currently doing.”

Alternatives considered:
- Encode transient sync status directly into the tab indicator.
  Rejected because it changes the meaning of the tab icon and mixes durable location with short-lived worker state.

## Risks / Trade-offs

- [Session remount can reset more UI/runtime state than users expect] → Scope remount-triggered resets to document/session-owned state and keep shell-local layout state outside the session host.
- [Document rename introduces a new modeling/authored mutation surface] → Keep it narrow and durable; do not create another workbench-only naming store.
- [Open/import flows may race tab creation and session activation] → Sequence them explicitly as create tab → persist tab state → activate tab → mount session with replacement basis.
- [Local-file sync listeners are currently active-document oriented] → Make status/view-model derivation document-scoped so tab indicators and active-session messages read from the correct `documentId`.
- [Discarding old tab localStorage can surprise existing dev data] → Treat the tab-store key/version as replaceable workspace metadata and keep the break explicit in the change.

## Migration Plan

1. Add the durable document-name field and its runtime/schema handling.
2. Introduce the active-document session host at app/workbench composition level.
3. Rework the tab state model so active-tab changes drive session-host switching instead of a no-op callback.
4. Update whole-document file actions to create and activate new tabs.
5. Re-derive per-tab `storageKind` and tab title from document-scoped state after session load.
6. Replace the old workbench-tab persistence payload with the new canonical version and remove any no-op single-document assumptions.

Rollback is straightforward during development: revert the session-host composition and tab/file-action changes. No production migration plan is needed for preserved UI-local tab metadata because this change intentionally does not promise compatibility for old tab-store payloads.

## Open Questions

- Whether document rename belongs as a first-class `ModelingService` mutation or as a whole-document replacement shortcut that only changes the durable authored envelope.
- Whether the active-document session host should live directly under `App.tsx` or as a dedicated workbench application module that `CadWorkbench` composes.
- Whether creating a blank tab should eagerly create a seeded persisted authored document immediately or only instantiate the repository-backed document on first activation.
