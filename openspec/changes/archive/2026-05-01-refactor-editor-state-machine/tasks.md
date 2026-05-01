## 1. Split helpers.ts into focused modules

- [x] 1.1 Create `src/core/editor/state-machine/state-creators.ts`
- [x] 1.2 Create `src/core/editor/state-machine/effect-emitters.ts`
- [x] 1.3 Create `src/core/editor/state-machine/error-mapping.ts`
- [x] 1.4 Create `src/core/editor/state-machine/form-traversal.ts`
- [x] 1.5 Create `src/core/editor/state-machine/selection-helpers.ts`
- [x] 1.6 Create `src/core/editor/state-machine/document-helpers.ts`
- [x] 1.7 Reduce `helpers.ts` to thin re-export facade
- [x] 1.8 Verify all existing tests pass

## 2. Unify the effect runtime

- [x] 2.1 Create `src/application/editor/effect-registry.ts` with `createEffectExecutor`
- [x] 2.2 Move `createModelingServiceEditorEffectRuntime` into `effect-registry.ts`
- [x] 2.3 Update `create-app-editor-effect-runtime.ts` to import from new location
- [x] 2.4 Make `state-machine-runtime.ts` a thin re-export plus test utilities
- [x] 2.5 Verify all existing tests pass

## 3. Create the TEA event loop

- [x] 3.1 Create `src/application/editor/editor-event-loop.ts` — `EditorEventLoop` class
- [x] 3.2 Write unit tests for `EditorEventLoop` (application lane, orchestration seam)
- [x] 3.3 Create React hook wrapping `EditorEventLoop` in `src/hooks/use-editor-event-loop.ts`
- [x] 3.4 Update `src/hooks/editor-provider.tsx` to use `useEditorEventLoop`
- [x] 3.5 Update `src/domain/editor/runtime-machine.spec.ts` to use `EditorEventLoop`
- [x] 3.6 Update barrel exports to export `EditorEventLoop` types and factory
- [x] 3.7 Delete `src/application/editor/runtime-machine.ts`
- [x] 3.8 Remove `xstate` from `package.json`
- [x] 3.9 Verify all tests pass and the app runs correctly

## 4. Split the monolithic reducer

- [x] 4.1 Define workflow event subset types as `Extract` unions in `src/core/editor/state-machine/types.ts` — `SketchEvent`, `FeatureEvent`, `ImportEvent`, `SectionEvent`
- [x] 4.2 Create `src/core/editor/state-machine/reducer-sketch.ts` — receives `SketchEditorState` and `SketchEvent`, no `state.kind` checks. Handles sketch pointer, drag, tool patch, history cursor, annotation, special mode, sketch-specific tool activation, cancel, commit
- [x] 4.3 Create `src/core/editor/state-machine/reducer-feature.ts` — receives `FeatureEditorState` and `FeatureEvent`. Handles form patches, reference picker, feature-specific cancel/commit
- [x] 4.4 Create `src/core/editor/state-machine/reducer-import.ts` — receives `ImportEditorState` and `ImportEvent`. Handles file selected, provider selected, selection patched, commit requested, cancelled, committed, failed
- [x] 4.5 Create `src/core/editor/state-machine/reducer-section.ts` — receives `SectionViewEditorState` and `SectionEvent`. Handles offset updated, flip requested, cleared
- [x] 4.6 Create `src/core/editor/state-machine/reducer-root.ts` — `transitionEditorState` that narrows state and event types, routes to active workflow reducer, falls back to shared handling (session.started, tool.activated, viewport.*, document.*, effect.*, history.*)
- [x] 4.7 Delete `transitions-core.ts` and update the barrel `index.ts` to export `transitionEditorState` from `reducer-root.ts`
- [x] 4.8 Verify all existing pure reducer tests pass without modification

## 5. Formalize the cursor lifecycle

- [x] 5.1 Create `src/core/editor/state-machine/cursor-lifecycle.ts` — `advanceCursorPhase(context, trigger)` and `getCursorPhaseAction(context)` formalizing the 5-phase lifecycle
- [x] 5.2 Refactor `continueAfterSnapshotRefresh` in `document-helpers.ts` to use the cursor lifecycle module instead of inline phase checks
- [x] 5.3 Write core-lane unit tests for cursor lifecycle phase transitions (pure inputs/outputs, shared builder if multiple tests need the same setup)
- [x] 5.4 Verify all existing tests pass

## 6. Cleanup shim files and test utilities

- [x] 6.1 Update all imports across transition files and consumers to use specific modules — delete `helpers.ts` (7-line re-export facade)
- [x] 6.2 Move `replayEditorEvents` and `replayEditorEventsWithRuntime` from `state-machine-runtime.ts` to a shared test builder file
- [x] 6.3 Delete `state-machine-runtime.ts` and update all imports
- [x] 6.4 Run full test suite (`bun run test`) and verify no regressions
