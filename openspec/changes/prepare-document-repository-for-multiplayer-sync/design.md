## Context

The local `DocumentRepository` phase introduces an authored Automerge-backed document in IndexedDB while keeping existing UI and kernel APIs stable. That is necessary but not sufficient for multiplayer: the current modeling contract still mostly thinks in linear revisions, and CAD feature history has semantics that an automatically merged data structure cannot fully validate by itself.

This phase prepares the repository and modeling boundary for multiple local or remote writers. The first concrete sync target is local peer sync between browser tabs. Hosted collaboration, presence, permissions, and sharing UX remain outside this phase.

## Goals / Non-Goals

**Goals:**
- Add head-aware repository metadata and document-change subscriptions needed for multi-writer operation.
- Sync local peers, such as multiple tabs on the same origin, through an `automerge-repo` browser network adapter.
- Define deterministic merge semantics for authored document records and ordered CAD data.
- Preserve the modeling service and editor boundaries so UI code still does not import Automerge.
- Surface merge and semantic conflict diagnostics when CRDT merge succeeds structurally but CAD validation cannot accept the resulting authored model.

**Non-Goals:**
- No hosted sync server, user accounts, permissions, sharing links, or cloud storage.
- No presence cursors, multiplayer UI, comments, annotations, or awareness indicators.
- No direct editing of Automerge handles from React components or editor state.
- No guarantee that every concurrent CAD operation can be semantically accepted without diagnostics or repair.

## Decisions

### Treat Automerge heads as repository metadata, not UI state

`DocumentRepository` should expose causal metadata needed by the modeling service, such as current heads and change source, but UI-facing snapshot fields can keep the existing revision display where possible. The modeling service can map head-aware freshness into current mutation result shapes or explicit diagnostics.

Alternative considered: replace every `revisionId` in the app with Automerge heads. That would create a broad UI and contract migration before multiplayer behavior is proven.

### Add automerge-repo local peer sync before remote sync

The first sync adapter should target same-origin browser peers through `BroadcastChannelNetworkAdapter` from `@automerge/automerge-repo-network-broadcastchannel`. This validates subscription, reload, merge, and rebuild behavior without introducing server availability, auth, or network partition concerns.

Alternative considered: use `@automerge/react` hooks directly. That would expose Automerge handles to React and bypass the `DocumentRepository` isolation goal. Building cloud sync first was also rejected because it would entangle repository semantics with product decisions around accounts, document ownership, and hosting.

### Keep semantic validation after CRDT merge

Automerge can merge authored data structures, but CAD semantics still require validation: a feature can reference deleted topology, two edits can produce invalid feature order, or cursor state can point to an absent item. The repository/modeling boundary should rebuild and validate merged authored state, then surface diagnostics without silently remapping durable references.

Alternative considered: prevent conflicting edits before they reach the document. That only works for single-writer flows and does not handle offline or remote concurrent updates.

### Make ordered data deterministic

Feature order, cursor state, and variable/sketch/feature collections need deterministic concurrent behavior. The authored document should avoid deriving identity from array position and should define how simultaneous insertions, deletes, renames, and cursor moves are interpreted.

Alternative considered: rely entirely on Automerge list ordering. That may be structurally deterministic, but the CAD domain still needs explicit rules for what order means to rebuild and diagnostics.

## Risks / Trade-offs

- [Linear revision checks reject valid concurrent merges] -> Introduce head-aware freshness metadata at the repository/modeling boundary and map it deliberately into existing mutation outcomes.
- [CRDT merge creates semantically invalid CAD state] -> Rebuild merged authored state through the modeling boundary and surface merge diagnostics instead of silently repairing references.
- [Concurrent feature ordering surprises users later] -> Define deterministic order and cursor rules now, even before multiplayer UI exists.
- [Local peer sync causes refresh storms] -> Debounce repository change notifications and keep editor refresh effects idempotent.
- [Phase 2 depends on phase 1 artifacts] -> Implement only after the local `DocumentRepository` capability is accepted or carry the required repository interface changes forward during implementation.

## Migration Plan

1. Extend repository metadata to expose causal heads and change source without changing UI-facing component APIs.
2. Add `BroadcastChannelNetworkAdapter` networking for same-origin browser tabs.
3. Trigger modeling snapshot refreshes from repository change notifications.
4. Add merge validation after remote/local peer changes are applied to the authored document.
5. Add deterministic handling for concurrent feature order, cursor, label, variable, sketch, and feature edits.
6. Keep remote/cloud sync disabled until a later proposal defines server, auth, sharing, and presence behavior.

## Open Questions

- Should semantic merge diagnostics be stored in the authored document, derived during rebuild, or both?
- How should the app present concurrent rename conflicts once multiplayer UI exists?
- Should feature cursor changes be last-writer-wins, head-specific, or treated as per-user/editor state in a later collaboration UX?
