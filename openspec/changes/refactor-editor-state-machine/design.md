## Context

The editor runtime currently uses xstate as an orchestration wrapper around a pure functional reducer (`transitionEditorState`). The xstate machine has 6 workflow states that mirror `state.kind` in the pure machine, adding a layer of indirection without meaningful orchestration value. The real state machine is the ~6,500-line pure reducer that returns `{ state, effects[] }`.

The codebase has three pain points beyond xstate:
1. A monolithic 752-line switch in `transitions-core.ts` routing 44+ event types
2. A 1,597-line `helpers.ts` mixing state creators, effect emitters, error mapping, form traversal, and selection logic
3. A 3-layer effect runtime split across `runtime-machine.ts`, `state-machine-runtime.ts`, and `create-app-editor-effect-runtime.ts`

Consumer surface for xstate is small: only `editor-provider.tsx` and the barrel `domain/editor/runtime-machine.ts` import the xstate actor. 26 files import from the pure state machine barrel.

Multiplayer is planned but only for document-level sync via Automerge. Editor state (active tool, sketch session, selection, hover) remains local per client. The `document.refreshRequested` event is the existing integration seam.

## Goals / Non-Goals

**Goals:**
- Remove xstate and replace with a minimal TEA event loop that preserves all existing behavioral contracts (effect ordering, stale-result rejection, command correlation, cursor sequencing)
- Decompose the monolithic reducer into per-workflow reducers that each handle only their valid events
- Split `helpers.ts` into focused, navigable modules
- Unify effect execution into a single registry
- Make the `EditSessionCursorContext` lifecycle explicit and self-contained
- Keep every phase independently mergeable with the codebase in a working state

**Non-Goals:**
- Changing the `(state, event) -> { state, effects[] }` contract
- Adding new editor features or changing CAD behavior
- Extracting domain logic from transitions into separate service functions (deferred to a follow-up — the structural decomposition comes first)
- Introducing a new state management library (the pure reducer pattern is sufficient)
- Refactoring the `EditorEvent` or `EditorEffect` type hierarchies
- Addressing multiplayer concerns beyond preserving the `document.refreshRequested` seam

## Decisions

### D1: TEA event loop as a plain class, not a React hook

The `EditorEventLoop` is a framework-agnostic TypeScript class with `dispatch`, `subscribe`, `getState`, `start`, `stop`. A thin React hook (`useEditorEventLoop`) wraps it for the provider.

**Rationale:** Keeps the event loop testable without React. The xstate actor tests (`runtime-machine.spec.ts`) create an actor, send events, and assert state — the same pattern works with a plain class. A React-only `useReducer` approach would force all integration tests through React rendering.

**Alternative considered:** `useReducer` + `useEffect` directly in the provider. Rejected because it couples the effect queue lifecycle to React's render cycle, making it harder to test and reason about effect ordering independently.

### D2: Effect staleness handled by the reducer, not the loop

The current `effectMatchesState()` in `runtime-machine.ts` pre-filters stale effects before invoking the runner. This check is redundant — every `handleEffect*` function in `transitions-effects.ts` already validates `requestId`, `commandSessionId`, and document context, returning `{ state, effects: [] }` for stale results.

**Decision:** Remove `effectMatchesState` from the event loop. Let stale effect results flow through the reducer, which already handles them safely. This eliminates the duplicated state-matching knowledge.

**Risk:** A stale effect that previously was never even executed will now execute and return a result that gets no-oped by the reducer. This is safe but wastes a network call. Acceptable trade-off for eliminating the duplication.

### D3: Per-workflow reducers return `null` for unhandled events

```typescript
type WorkflowReducer<S extends EditorState> = (
  state: S, event: EditorEvent, deps: EditorExtensionDependencies
) => EditorTransitionResult | null
```

A `null` return means "this workflow doesn't handle this event, try root." The root reducer applies shared logic (viewport, document refresh, tool activation, effect completions) when no workflow claims the event.

**Alternative considered:** Each workflow reducer handles all events with a `{ state, effects: [] }` fallback. Rejected because it would require duplicating shared event handling in every workflow or using a fallthrough chain that obscures control flow.

### D4: Preserve `helpers.ts` as a re-export facade during split

After splitting into focused modules, `helpers.ts` becomes a thin re-export file. All existing `import from './helpers'` statements continue working. The facade is removed in a follow-up once all imports are updated to the specific modules.

**Rationale:** Minimizes diff size per phase. A bulk import rewrite across 6+ transition files is mechanical but noisy — better done as a separate commit.

### D5: Cursor lifecycle as explicit phase transition functions

The 5-phase `EditSessionCursorContext` (`rollingBack → opening → active → restorePending → restoring`) is extracted into a self-contained module with:
- `advanceCursorPhase(context, trigger) → EditSessionCursorContext | null`
- `getCursorPhaseAction(context) → 'openSession' | 'hydrateFeature' | 'restore' | 'complete'`

This replaces the scattered `if (cursorContext?.phase === ...)` checks in `continueAfterSnapshotRefresh`.

**Alternative considered:** A separate xstate child machine for cursor lifecycle. Rejected — we're removing xstate, and the lifecycle is simple enough for explicit transition functions.

### D6: Recursive `transitionEditorState` calls preserved as internal dispatch

Three places call `transitionEditorState` recursively (tool activation mapping undo/redo, sketch special mode callbacks). These are preserved as-is — they are synchronous internal dispatch within the same reducer call, not re-entrant event loop dispatch. The per-workflow split does not affect them because they route through the root reducer.

## Risks / Trade-offs

- **[Risk] xstate devtools lost** → The xstate inspector and visualizer will no longer work. Mitigation: add a `debug` subscriber to the event loop that logs `{ event, prevState.kind, nextState.kind, effects[] }` in development. This is simpler than xstate's devtools for this use case since the machine is a pure function.

- **[Risk] Effect execution ordering changes subtly** → The current xstate machine processes one effect at a time via `invoke`. The TEA loop must maintain this serial execution guarantee. Mitigation: the loop drains effects one-at-a-time with `await`, matching current behavior. Add an assertion in tests that verifies effects never execute concurrently.

- **[Risk] Stale effects now execute instead of being pre-filtered** → See D2. The reducer safely no-ops stale results, but the effect still runs. Mitigation: for expensive effects (feature preview, sketch commit), the runtime adapter can check document context before making the network call. This is an optimization, not a correctness concern.

- **[Risk] Per-workflow reducer routing introduces a new failure mode** → If a workflow reducer incorrectly claims an event, the root handler never sees it. Mitigation: TypeScript exhaustive checking on `state.kind` in the root router. Each workflow reducer only matches events with an explicit `case` — no catch-all.

- **[Trade-off] Temporary dual structure during helpers.ts split** → The re-export facade means two import paths work simultaneously. This is intentional and temporary — the facade is removed once imports are migrated.

- **[Trade-off] No domain logic extraction in this change** → Transition handlers still contain embedded domain logic (sketch geometry, selection rules). This is deferred to keep the change focused on structural decomposition. The per-workflow split creates clean seams for domain extraction in a follow-up.
