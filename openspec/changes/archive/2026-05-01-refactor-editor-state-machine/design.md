## Context

The editor runtime has been migrated off xstate (phases 1–3 complete). The TEA event loop (`EditorEventLoop`) is in place, `helpers.ts` is split into focused modules, and the effect runtime is unified in `effect-registry.ts`.

What remains is the monolithic reducer: `transitions-core.ts` is a 752-line switch routing 44+ event types. Every handler receives `EditorEvent` (111 types) and `EditorState` (6-kind union), manually checking `state.kind` before proceeding. The `EditSessionCursorContext` lifecycle is still scattered across conditional checks in `continueAfterSnapshotRefresh`.

Backwards compatibility is explicitly not a constraint — no re-export facades, no barrel preservation, no gradual import migration. All imports can be updated directly.

## Goals / Non-Goals

**Goals:**
- Decompose the monolithic reducer into per-workflow reducers with narrowed state and event types
- Eliminate `state.kind` checks inside workflow handlers — the root reducer narrows once before delegation
- Make the cursor lifecycle explicit and self-contained
- Delete remaining shim files (`helpers.ts` 7-line facade, `state-machine-runtime.ts` re-exports)
- Move test utilities to test files
- All new tests follow `docs/testing.md` lane and seam rules

**Non-Goals:**
- Changing the `(state, event) -> { state, effects[] }` contract at the root boundary
- Adding new editor features or changing CAD behavior
- Extracting domain logic from transitions into separate service functions (follow-up)
- Refactoring `EditorEvent` or `EditorEffect` type hierarchies
- Splitting `EditorState` into `{ shared, workflow }` (follow-up after reducer split stabilizes)

## Decisions

### D1: Narrowed state and event types per workflow reducer

Each workflow reducer receives an already-narrowed state type and a workflow-scoped event subset:

```typescript
type SketchEvent = Extract<EditorEvent,
  | { type: `sketch.${string}` }
  | { type: 'command.cancelled' }
  | { type: 'command.commitRequested' }
  | { type: 'history.undoRequested' }
  | { type: 'history.redoRequested' }
>

function reduceSketchWorkflow(
  state: SketchEditorState,
  event: SketchEvent,
  deps: EditorExtensionDependencies,
): EditorTransitionResult
```

The root reducer does the `state.kind` switch once and the event-type check once. Workflow reducers never check `state.kind` — it's guaranteed by the caller. They can also assume the event type is valid.

**Rationale:** Real type safety. The current pattern of `if (state.kind !== 'editingSketch') return { state, effects: [] }` at the top of every handler is a runtime check compensating for a type gap. Narrowing eliminates the gap.

**Alternative considered:** Keep `EditorEvent` as the parameter type and let each handler `switch` on it. Rejected — this preserves the current problem of 111 event types flowing everywhere.

### D2: Root reducer routes, then falls back to shared handling

```typescript
export function transitionEditorState(
  state: EditorState,
  event: EditorEvent,
  deps: EditorExtensionDependencies,
): EditorTransitionResult {
  // 1. Try workflow-specific reducer (narrowed types)
  const result = routeToWorkflow(state, event, deps)
  if (result) return result

  // 2. Shared event handling (viewport, document, effects, tool activation)
  return handleSharedEvent(state, event, deps)
}
```

The `routeToWorkflow` function checks `state.kind` and event type to determine if the active workflow handles this event. If the workflow reducer returns a result, it wins. Otherwise, shared handlers apply.

This means viewport events, document events, effect completions, and tool activation are always handled at the root level — they are cross-cutting concerns, not workflow-specific.

### D3: Delete shim files directly, update all imports

No facade files. `helpers.ts` (7 lines) and `state-machine-runtime.ts` are deleted. All imports across the codebase are updated to point at the actual module. Test utilities (`replayEditorEvents`, `replayEditorEventsWithRuntime`) move to a shared test builder file.

**Rationale:** With no backwards-compat constraint, shim files are pure noise. Direct imports make the dependency graph honest.

### D4: Cursor lifecycle as explicit phase transition functions

The 5-phase `EditSessionCursorContext` (`rollingBack → opening → active → restorePending → restoring`) is extracted into `cursor-lifecycle.ts` with:
- `advanceCursorPhase(context, trigger) → EditSessionCursorContext | null`
- `getCursorPhaseAction(context) → 'openSession' | 'hydrateFeature' | 'restore' | 'complete'`

This replaces the scattered `if (cursorContext?.phase === ...)` checks in `continueAfterSnapshotRefresh`.

### D5: Recursive `transitionEditorState` calls preserved

Three places call `transitionEditorState` recursively (tool activation mapping undo/redo, sketch special mode callbacks). These are preserved — they are synchronous internal dispatch within the same reducer call. The per-workflow split does not affect them because they route through the root reducer.

### D6: Test placement follows docs/testing.md

- **Event loop tests** (`editor-event-loop.spec.ts`): Application lane — orchestration seam tests. Mock the effect executor, assert sequencing, stale-result handling, error propagation. Already implemented.
- **Workflow reducer tests**: Core/domain lane — pure inputs and outputs. Assert state transitions and emitted effects at the exported boundary. Use shared builders (`make...`, `create...`) per seam, not one-off harnesses.
- **Cursor lifecycle tests**: Core lane — pure phase transition assertions.
- **Test utilities** (`replayEditorEvents`, `replayEditorEventsWithRuntime`): Move to a shared test builder file, not production code.

## Risks / Trade-offs

- **[Risk] Event routing mismatch** → If `routeToWorkflow` incorrectly classifies an event as workflow-handled when it should be shared, the shared handler never sees it. Mitigation: the event subset types are explicit `Extract` unions — TypeScript prevents an event from accidentally matching a workflow it doesn't belong to.

- **[Risk] Narrowed event types drift from actual usage** → If a new event is added to `EditorEvent` but not to any workflow's event subset, it silently falls through to shared handling (which may no-op). Mitigation: exhaustive checking in `handleSharedEvent`'s switch ensures unhandled events are caught at compile time.

- **[Trade-off] No domain logic extraction** → Transition handlers still contain embedded domain logic. Deferred to keep this change focused on structural decomposition. The per-workflow split creates clean seams for domain extraction in a follow-up.
