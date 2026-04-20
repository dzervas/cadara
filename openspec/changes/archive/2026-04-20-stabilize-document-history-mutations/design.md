## Context

Document history cursor movement currently has two owners. Edit-session rollback and restore are modeled as editor runtime effects, while bottom timeline dragging and document-level Undo/Redo call `modelingService.setFeatureCursor` directly from Workbench UI code and then request a refresh. That bypass leaves the editor with stale snapshot state while the modeling service and repository have already advanced.

Repository-backed documents add another freshness dimension. Modeling mutations are based on `baseRevisionId`, but repository freshness is tracked through repository head metadata. The service currently compares current repository heads with a service-global "last snapshot" value instead of a mutation basis supplied by the caller. That makes repository conflicts depend on which snapshot the service most recently attached provenance to, not necessarily the snapshot that initiated the mutation.

## Goals / Non-Goals

**Goals:**

- Give document history cursor movement one editor-owned mutation path for timeline drag, document Undo/Redo, edit-entry rollback, and edit-exit restore.
- Make the mutation basis explicit: kernel revision plus repository provenance from the snapshot used to initiate the mutation.
- Ensure accepted cursor mutations always update editor revision state and refresh the authoritative snapshot before later cursor mutations are accepted from the UI.
- Make repository-head conflicts deterministic and recoverable by refreshing the editor snapshot instead of allowing repeated stale mutation notifications.
- Preserve transient edit-session cursor moves as orchestration that does not append operation-history entries.
- Add focused regression tests that cover the direct failure modes: timeline drag, document Undo/Redo, repository-backed rollback/redo loops, stale repository provenance, and edit-session restore.

**Non-Goals:**

- Redesigning document history ordering, branching history semantics, feature insertion rules, or sketch-local history.
- Changing kernel adapter revision-conflict semantics for non-repository documents.
- Persisting render, body, or applied snapshot output in authored documents.
- Adding collaboration UI beyond honoring repository head provenance.

## Decisions

1. Route document cursor requests through the editor runtime.

   Add an editor event for document cursor movement and have timeline drag, document Undo, and document Redo dispatch that event instead of calling `modelingService.setFeatureCursor` directly. The existing `document.moveHistoryCursor` effect remains the runtime-owned async boundary. Edit rollback and restore continue to use the same effect.

   Rationale: the editor runtime already owns request IDs, stale-result checks, pending cursor request state, and snapshot follow-up after cursor moves. Keeping cursor mutation in that path removes a race between React-local `snapshotRef` state and editor state-machine effects.

   Alternative considered: keep direct Workbench calls but add more refreshes. That still leaves two sequencing owners and does not prevent a second cursor request from using a stale snapshot before the refresh completes.

2. Add a snapshot mutation basis to frontend-facing modeling mutations.

   Extend frontend-facing mutation inputs with an optional basis that carries `baseRevisionId` and repository heads from the snapshot used by the caller. For cursor moves initiated by the editor runtime, the effect should carry that basis from `state.snapshot`. The kernel adapter request can continue to receive `baseRevisionId`; repository provenance belongs at the modeling service/repository layer.

   Rationale: revision ID checks and repository-head checks protect different state. A mutation against `rev_7` can still be stale if a peer or repository write changed authored storage after the caller loaded `rev_7`.

   Alternative considered: encode repository heads into revision IDs. That conflates kernel revisions with repository metadata and would broaden adapter contracts unnecessarily.

3. Compare repository freshness against the caller's basis, not service-global snapshot state.

   The modeling service should evaluate repository-head conflicts by comparing current repository metadata with the request's base repository heads when supplied. If no repository is configured, or no repository provenance exists on the snapshot, the existing revision-only path remains valid.

   Rationale: a stale mutation should be rejected because the mutation's own snapshot basis is stale, not because another service call refreshed or did not refresh global metadata.

   Alternative considered: keep `snapshotRepositoryHeads` as the only freshness source. That cannot represent concurrent editor effects or caller snapshots precisely.

4. Treat cursor conflicts as refreshable editor state.

   When a document cursor move returns a repository-head conflict or revision conflict, the editor should clear the pending cursor request and request a fresh snapshot. User-visible feedback may still mention the stale basis, but the next available cursor action must be based on the refreshed snapshot.

   Rationale: document cursor moves do not contain unsaved draft edits. Refreshing is the correct recovery path and prevents the repeated "refresh before retrying" loop.

   Alternative considered: require the user to manually refresh. That is the failure mode this change is meant to remove.

5. Disable cursor-producing controls while a document cursor move is pending.

   The view state should expose unavailable document history actions while a cursor move or its follow-up snapshot fetch is pending. Timeline drag completion and document Undo/Redo should not issue another document cursor request until the refreshed snapshot is loaded.

   Rationale: cursor moves are cheap, but allowing overlapping moves from stale cursors creates inconsistent redo/rollback loops.

   Alternative considered: queue every user cursor move. That introduces ambiguous intent when the cursor target was computed from a snapshot that is no longer current.

## Risks / Trade-offs

- [Mutation input shape expands] -> Keep repository basis optional and confined to the frontend-facing modeling service types so kernel adapters remain focused on typed revision requests.
- [More editor runtime responsibility] -> Reuse the existing cursor effect and pending request fields instead of adding another orchestration layer.
- [UI availability behavior changes] -> Add focused tests for toolbar availability and timeline pending behavior so disabled states are deliberate and reversible after refresh.
- [Repository conflict handling could hide real failures] -> Only auto-refresh for stale revision/head conflicts; validation, unsupported cursor, and repository write diagnostics must still surface explicitly.
- [Existing direct Workbench undo stack still exists] -> Keep variable undo/redo entries in Workbench, but route document-history fallback through the editor runtime.

## Migration Plan

No data migration is required. Persisted authored documents, operation history, and repository payloads remain valid.

Implementation should proceed from contracts outward: add mutation-basis types and tests, route editor cursor events through the runtime, remove direct document cursor service calls from Workbench UI flows, then add repository-backed regression coverage. Rollback is code-only: revert to the prior direct Workbench cursor calls and service-global repository freshness behavior if needed.

## Open Questions

- Should stale document cursor conflicts show a brief status message after auto-refresh, or should a successful refresh be silent unless the retry still fails?
