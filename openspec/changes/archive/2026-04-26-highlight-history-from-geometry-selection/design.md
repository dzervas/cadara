## Context

The current snapshot and render contracts expose one `ownerFeatureId` for a body or renderable, and snapshot entities already expose `consumedByFeatureIds` for downstream consumers. Those signals are not precise enough for the requested behavior.

After a shell replaces a body, body-level ownership can collapse to `Shell` even when a preserved back face should still highlight only the original `Extrude`. Conversely, a newly created inner shell face should highlight both `Extrude` and `Shell`. That means the system needs per-topology contributor lineage, not just body ownership or downstream consumer metadata.

## Goals / Non-Goals

**Goals:**

- Derive a stable contributor feature list for selected body topology.
- Distinguish preserved topology from newly derived topology during replacement operations.
- Drive history-bar highlighting from current selection without mutating document cursor or feature edit state.
- Preserve the same contributor ancestry after rebuild, replay, and reload.

**Non-Goals:**

- Changing ordinary feature selection, reopen, or cursor-move behavior in the history bar.
- Introducing hover-driven history highlighting.
- Persisting UI highlight state in the authored document.
- Solving every possible provenance question for diagnostics or export beyond what is needed for selection-driven history highlighting.

## Decisions

### Add explicit contributor ancestry to snapshot entities

The frontend should consume an explicit `contributingFeatureIds` list from rebuilt snapshot entities for selectable body topology targets instead of trying to infer ancestry from `ownerFeatureId`, render-record order, or document history scans.

This keeps the behavior deterministic across live edits and reload. It also keeps the history bar decoupled from OCC-specific reasoning.

Alternative considered: derive history highlights in React from the selected target's current `ownerFeatureId` and related body target. Rejected because replacement bodies are too coarse and would incorrectly highlight `Shell` for preserved extrude faces.

### Build contributor ancestry during topology reconciliation

Contributor ancestry should be established where topology replacement is already reconciled. Unique-successor topology that survives a replacement should retain its predecessor contributor list unchanged. Newly created topology should add the current feature and, when the new topology is derived from existing source topology, inherit that source contributor list before appending the current feature.

This is the rule that allows:
- preserved back faces on a shelled cube to remain `Extrude`-only
- new inner shell faces to become `Extrude` + `Shell`

Alternative considered: mark every topology primitive on a replacement body with the current feature plus the previous body owner. Rejected because it would over-highlight unrelated preserved faces and make shell-like operations look as if they rewrote the entire body.

### Keep history highlighting as derived editor view state

The editor runtime should derive a history-highlight feature-id set from the current primary visible selection and the selected entity's `contributingFeatureIds`. The timeline consumes that derived set as presentation state only.

This preserves the difference between:
- what is selected
- where the document cursor is
- which history items should be visually emphasized for the current geometry

Alternative considered: translate geometry selection into multi-selection of feature targets. Rejected because it would overload existing selection semantics, interfere with feature edit routing, and make empty-click clearing and keyboard behavior harder to reason about.

### Order contributor ids by authored history

`contributingFeatureIds` should be emitted in current authored-history order rather than creation-time discovery order or topology traversal order.

That keeps tests stable, makes UI interpretation predictable, and matches how users read the timeline from upstream to downstream.

Alternative considered: emit an unordered set. Rejected because unstable ordering would leak implementation details into tests and make future UI affordances harder to build.

## Risks / Trade-offs

- [Risk] Some feature executors may not currently expose enough source-topology context to distinguish preserved and newly derived subshapes. → Mitigation: start from topology reconciliation and add narrow provenance hooks only where replacement features such as shell need them.
- [Risk] Overly broad inheritance rules could highlight too many upstream features. → Mitigation: require unique-successor preservation for unchanged topology and add feature-specific tests for shell-style derived faces.
- [Risk] Snapshot schema growth could ripple through validation and mock fixtures. → Mitigation: extend `SnapshotEntityRecord` in one place and update fixtures through shared builders instead of ad hoc object literals.
- [Risk] Selection refresh timing could leave stale highlights after rebuild. → Mitigation: recompute derived history-highlight state from the current snapshot and current visible selection on every accepted snapshot refresh.

## Migration Plan

1. Extend snapshot-entity contract/builders with contributor ancestry for selectable topology.
2. Teach topology replacement/rebuild flows to preserve or extend contributor ancestry for replacement features.
3. Derive history-highlight feature ids from current selection in the editor/runtime layer.
4. Update the feature timeline to render derived contributor highlights.
5. Add regression coverage for shell-inner-face, untouched-back-face, deselect, and reload cases.

Rollback is code-only: remove contributor-ancestry derivation and revert the history bar to direct feature-selection state only.

## Open Questions

None for the proposal. Implementation can choose whether contributor ancestry is stored directly on `SnapshotEntityRecord` or resolved from an adjacent snapshot map, as long as the frontend consumes one stable snapshot-facing contract.
