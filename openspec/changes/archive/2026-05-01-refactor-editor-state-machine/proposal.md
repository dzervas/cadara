## Why

The editor runtime orchestration was migrated to xstate but the team naturally built a pure functional reducer (`transitionEditorState`) that handles all real business logic (~6,500 lines). xstate served only as an effect queue runner — its 6 workflow states duplicated `state.kind` in the pure machine, adding indirection without value. The monolithic reducer, a 1,597-line helper grab-bag, and a 3-layer effect runtime made the codebase hard to navigate, extend, and test in isolation. With multiplayer (Automerge document sync) arriving soon, the editor-local state path needs to be clean and self-contained.

## What Changes

**Already completed (phases 1–3):**
- **Removed xstate dependency** and replaced the runtime machine with a plain TEA (The Elm Architecture) event loop (`EditorEventLoop`) that calls the pure reducer, manages an effect queue, and feeds results back.
- **Decomposed `helpers.ts`** into focused modules: state-creators, effect-emitters, error-mapping, form-traversal, selection-helpers, document-helpers, utility-helpers.
- **Unified the effect runtime** into `effect-registry.ts` with `createEffectExecutor`, keeping the app adapter separate.
- **Deleted** `runtime-machine.ts` (xstate wrapper) and removed xstate from dependencies.

**Remaining work (phases 4–6):**
- **Split the monolithic reducer** (`transitions-core.ts`, 752-line switch) into per-workflow reducers (sketch, feature, import, section) coordinated by a root reducer that routes to the active workflow then falls back to shared event handling.
- **Narrowed workflow types** — each per-workflow reducer receives already-narrowed state (`SketchEditorState`, not `EditorState`) and a workflow-scoped event subset type. The root reducer does the `state.kind` check once and narrows before delegation. No backwards-compat shims.
- **Formalize the cursor lifecycle** — make the implicit 5-phase `EditSessionCursorContext` sub-state-machine explicit and self-contained.
- **Delete remaining shim files** — `helpers.ts` (now 7-line re-export) and `state-machine-runtime.ts` are deleted, all imports updated to point to the actual modules. Test utilities (`replayEditorEvents`, `replayEditorEventsWithRuntime`) move to a test helper file.

## Capabilities

### New Capabilities
- `tea-editor-event-loop`: Framework-agnostic TEA event loop class replacing xstate for editor runtime orchestration — dispatch, effect queue, subscribe, start/stop lifecycle. **(Implemented)**
- `per-workflow-reducers`: Per-workflow reducer modules (sketch, feature, import, section) with narrowed state and event types, coordinated by a root router replacing the monolithic `transitionEditorState` switch.
- `cursor-lifecycle`: Explicit cursor lifecycle module formalizing the 5-phase `EditSessionCursorContext` state machine.

### Modified Capabilities
- `editor-runtime-orchestration`: Runtime orchestration moved from xstate actor to plain TEA event loop. All behavioral requirements (effect ordering, stale-result safety, command correlation, cursor sequencing) are preserved — only the orchestration mechanism changed. **(Implemented)**

## Impact

- **Code**: `src/application/editor/runtime-machine.ts` deleted. `src/core/editor/state-machine/helpers.ts` split into 6+ focused modules. `src/core/editor/state-machine/transitions-core.ts` to be replaced by per-workflow reducers + root router. `src/hooks/editor-provider.tsx` simplified.
- **Dependencies**: `xstate` removed from `package.json`.
- **Tests**: `runtime-machine.spec.ts` updated to use `EditorEventLoop`. `state-machine.spec.ts` tests the pure reducer directly (unchanged). New tests follow `docs/testing.md` — event loop tests are application-lane orchestration seam tests, workflow reducer tests are core/domain-lane seam tests.
- **APIs**: No backwards-compat facades. All imports updated directly.
- **Multiplayer**: No impact. `document.refreshRequested` remains the integration seam for Automerge sync. Editor state stays local.
