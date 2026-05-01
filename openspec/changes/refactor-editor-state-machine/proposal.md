## Why

The editor runtime orchestration was migrated to xstate but the team naturally built a pure functional reducer (`transitionEditorState`) that handles all real business logic (~6,500 lines). xstate serves only as an effect queue runner — its 6 workflow states duplicate `state.kind` in the pure machine, adding indirection without value. The monolithic reducer, a 1,597-line helper grab-bag, and a 3-layer effect runtime make the codebase hard to navigate, extend, and test in isolation. With multiplayer (Automerge document sync) arriving soon, the editor-local state path needs to be clean and self-contained.

## What Changes

- **Remove xstate dependency** and replace the runtime machine with a plain TEA (The Elm Architecture) event loop that calls the pure reducer, manages an effect queue, and feeds results back. The `transitionEditorState(state, event, deps) -> { state, effects[] }` contract is preserved exactly.
- **Split the monolithic reducer** (`transitions-core.ts`, 752-line switch) into per-workflow reducers (sketch, feature, import, section) coordinated by a root reducer that routes to the active workflow then falls back to shared event handling.
- **Decompose `helpers.ts`** (1,597 lines, 54+ exports) into focused modules: state creators, effect emitters, error mapping, form traversal, selection helpers, document helpers.
- **Unify the effect runtime** from 3 scattered files (`runtime-machine.ts` effect queue, `state-machine-runtime.ts` executor, `create-app-editor-effect-runtime.ts` app adapter) into a single effect registry plus app adapter.
- **Extract domain logic** from transition handlers into domain service functions so transitions become thin adapters.
- **Formalize the cursor lifecycle** — make the implicit 5-phase `EditSessionCursorContext` sub-state-machine explicit and self-contained.
- **BREAKING**: `createEditorRuntimeActor` and `EditorRuntimeActor` xstate exports are removed. Consumers switch to `EditorEventLoop`.

## Capabilities

### New Capabilities
- `tea-editor-event-loop`: Framework-agnostic TEA event loop class replacing xstate for editor runtime orchestration — dispatch, effect queue, subscribe, start/stop lifecycle.
- `per-workflow-reducers`: Per-workflow reducer modules (sketch, feature, import, section) with a root router, replacing the monolithic `transitionEditorState` switch.
- `cursor-lifecycle`: Explicit cursor lifecycle module formalizing the 5-phase `EditSessionCursorContext` state machine.

### Modified Capabilities
- `editor-runtime-orchestration`: Runtime orchestration moves from xstate actor to plain TEA event loop. All behavioral requirements (effect ordering, stale-result safety, command correlation, cursor sequencing) are preserved — only the orchestration mechanism changes.
- `workbench-state-ownership`: No requirement changes — the ownership boundaries remain identical. Only the internal runtime implementation changes.

## Impact

- **Code**: `src/application/editor/runtime-machine.ts` deleted. `src/core/editor/state-machine/helpers.ts` split into 6 focused modules. `src/core/editor/state-machine/transitions-core.ts` replaced by per-workflow reducers + root router. `src/hooks/editor-provider.tsx` simplified.
- **Dependencies**: `xstate` removed from `package.json`.
- **Tests**: `runtime-machine.spec.ts` updated to use `EditorEventLoop` instead of xstate actor. `state-machine.spec.ts` unchanged (tests the pure reducer directly).
- **APIs**: Internal only — no public API changes. The `useEditorState` hook and its `{ machineState, state, dispatch }` shape are preserved.
- **Multiplayer**: No impact. `document.refreshRequested` remains the integration seam for Automerge sync. Editor state stays local.
