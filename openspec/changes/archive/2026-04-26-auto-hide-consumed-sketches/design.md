## Context

Committed sketches already appear in `Parts & Objects`, already support manual hide/show behavior, and already participate in document history. Separately, profile-based features already preserve explicit durable profile references, and the snapshot schema already exposes `consumedByFeatureIds` metadata on presentational entities. What is missing is a stable rule that turns "this sketch has been consumed by an applied profile-based feature" into effective hidden state for the viewport and sidebar.

The user requirement has an important nuance: a consumed sketch must be manually showable again, but reloading the document must auto-hide it again. That points away from persisting manual "show" overrides in authored document state and toward a derived visibility rule that is recomputed from rebuilt document state on startup.

## Goals / Non-Goals

**Goals:**

- Auto-hide committed sketches when an applied profile-based feature consumes one of their profiles.
- Recompute the same hidden state during rebuild and document reload from durable authored model state.
- Keep consumed sketches visible in navigation with hidden-state treatment and a working show action.
- Keep sidebar row state and viewport filtering driven by the same effective visibility model.

**Non-Goals:**

- Persisting manual "show consumed sketch" overrides across full document reload.
- Changing feature-definition payload shapes if existing profile ownership data is already sufficient.
- Hiding sketches that are merely selected, previewed, or edited but not consumed by an accepted applied feature.
- Redesigning the sidebar, history UI, or generic visibility affordances beyond the consumed-sketch behavior.

## Decisions

### Treat consumed-sketch hiding as derived effective visibility

Consumed-sketch hiding should be derived from the rebuilt snapshot, not stored as a durable authored hide flag. The runtime should recompute the auto-hidden sketch set whenever a new snapshot becomes current, including initial document restore.

This matches the requested behavior that reload hides used sketches again. It also keeps authored document state focused on modeling intent rather than viewport display preferences.

Alternative considered: persist a hide/show bit for sketches in the authored document. Rejected because it would make reload preserve manual show state, which conflicts with the requested "auto-hide again" behavior, and it would add UI-display state to the durable modeling contract.

### Reuse durable consumption metadata instead of inferring from UI selections

The change should use durable feature/profile ownership data that survives commit and replay. The preferred path is to expose or reuse per-sketch consumption metadata from the snapshot/presentation layer so the editor runtime can determine whether a committed sketch is consumed without inspecting transient form state, selection state, or recent user actions.

This keeps auto-hide deterministic for both live commits and reload-time rebuilds. It also avoids coupling presentational components to feature-definition parsing rules.

Alternative considered: infer consumed sketches directly inside React components from the active feature form or the latest commit event. Rejected because it would fail on reload, drift from replayed document state, and split the rule across UI and modeling layers.

### Layer explicit show overrides on top of auto-hidden sketches

Manual re-show should not delete or mutate the derived auto-hidden rule. Instead, the runtime should track a session-local explicit visibility override for auto-hidden sketch targets and compute effective hidden state from both sources.

One workable model is:
- `autoHiddenSketchKeys`: derived from the current snapshot
- existing explicit hidden intents for ordinary user hide actions
- explicit shown intents for consumed sketches the user re-exposed

Effective hidden state then becomes: explicitly hidden targets remain hidden; auto-hidden consumed sketches remain hidden unless explicitly shown for the current session.

This preserves the ability to un-hide a consumed sketch without losing the fact that it is still a consumed sketch. Reload clears the session-local shown overrides, so the derived hide rule applies again.

Alternative considered: inject consumed sketches directly into the existing hidden-target set on every rebuild. Rejected because a later manual show action would erase the system-derived reason for hiding, making reload-time reapplication and sidebar sync harder to reason about.

### Keep sidebar treatment and viewport filtering on one visibility selector

The sidebar row icon/state, hover/selection suppression, and viewport render filtering should all read from the same effective visibility computation. A consumed sketch must never appear visible in `Parts & Objects` while still being filtered from rendering, or vice versa.

This is preferable to separate sidebar-local and viewport-local rules because the user explicitly asked for hidden state to stay synced to the sidebar.

Alternative considered: treat auto-hide as a viewport-only filter while leaving sidebar rows visually visible until the user toggles them. Rejected because it produces contradictory state and hides important context from the primary visibility control surface.

## Risks / Trade-offs

- [Risk] Existing snapshot rows may not expose consumed-sketch metadata in the exact shape the runtime needs. → Mitigation: extend the snapshot or presentation builder in one place and add focused tests for commit and replay parity.
- [Risk] Session-local shown overrides can become stale after feature edits stop consuming a sketch. → Mitigation: reconcile overrides against the current derived auto-hidden set on each accepted snapshot and drop overrides for sketches that are no longer auto-hidden.
- [Risk] Mixed profile sources could hide the wrong sketch if planar-face and sketch-region ownership are conflated. → Mitigation: add coverage that only sketch-owned profile references contribute auto-hidden sketch keys.
- [Risk] Visibility logic could diverge between sidebar and viewport during pending refreshes. → Mitigation: centralize effective visibility computation in the editor/runtime layer and keep rendering surfaces as consumers only.

## Migration Plan

1. Confirm or extend the snapshot/presentation data needed to identify committed sketches consumed by applied profile-based features during live rebuild and replay.
2. Introduce a runtime-level effective visibility selector that combines derived auto-hidden sketch keys with explicit user visibility overrides.
3. Update `Parts & Objects` row rendering and visibility toggles to reflect the effective hidden state for consumed sketches.
4. Update viewport render, hover, and selection filtering to use the same effective hidden state.
5. Add focused tests for commit-time auto-hide, manual re-show, and reload-time re-derivation.

Rollback is code-only: remove the derived auto-hidden layer and revert sketch visibility to explicit user toggles only.

## Open Questions

None for the proposal. The implementation can decide whether consumed-sketch metadata is carried on sketch object rows directly or resolved from existing entity records, as long as commit and reload derive the same result.
