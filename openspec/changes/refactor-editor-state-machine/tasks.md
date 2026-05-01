## 1. Split helpers.ts into focused modules

- [ ] 1.1 Create `src/core/editor/state-machine/state-creators.ts` — move `initialEditorState`, `toIdleState`, `createCommandState`, `createFeatureEditingState`, `createImportingState`, `createSectionViewEditingState`, `enterSketchEditing`, `withActivationSelection`, `withPreview`, `previewEquals`
- [ ] 1.2 Create `src/core/editor/state-machine/effect-emitters.ts` — move `emitSnapshotFetch`, `emitDocumentCursorMove`, `emitEditSessionCursorRestore`, `emitSketchOpen`, `emitSketchCommit`, `emitSketchReferenceProjection`, `emitSketchReferenceImageImportWithPayloads`, `emitSketchSpecialModeEffect`, `emitFeaturePreview`, `emitFeatureCommit`, `emitFeatureHydration`, `getSnapshotMutationBasis`
- [ ] 1.3 Create `src/core/editor/state-machine/error-mapping.ts` — move `createEditorEffectFailureEvent`, `getEditorEffectContext`, `getAppErrorContextValue`, `getAppErrorRevisionId`, `getAppErrorDiagnosticCode`, `isModelingMutationError`, `modelingMutationErrorToDiagnostic`, `createPreviewFailedDiagnostics`, `getDurableDiagnosticTarget`
- [ ] 1.4 Create `src/core/editor/state-machine/form-traversal.ts` — move `findFormFieldById`, `findNestedFormFieldById`, `getActiveReferencePickerField`, `getImportSessionFormField`, `getImportSelectionFields`, `collectImportSelectionFields`, `getDefaultImportSelectionField`, `getActiveImportReferencePickerField`, `createImportViewportSelectionPatch`
- [ ] 1.5 Create `src/core/editor/state-machine/selection-helpers.ts` — move `adoptOrderedSelection`, `adoptSelectionForFilter`, `createSelectionPreview`, `createFeatureSelectionPreview`, `createImportSelectionPreview`
- [ ] 1.6 Create `src/core/editor/state-machine/document-helpers.ts` — move `updateStateDocument`, `updateStateDocumentSnapshot`, `replaceStateDocumentSnapshot`, `continueAfterSnapshotRefresh`, `hasPendingDocumentCursorRefresh`, `isRefreshableDocumentCursorConflict`, `eventMatchesDocument`, `eventMatchesOptionalDocument`, `createEditSessionCursorContext`, `canReopenSketchDirectlyFromCurrentCursor`, `applyRenderPreservationForFeatureDiagnostics`
- [ ] 1.7 Reduce `helpers.ts` to a thin re-export facade plus remaining utilities (`nextCommandSessionId`, `nextRequestId`, `isFeatureTool`, `isPassiveSketchTool`, `assertSketchPlaneSupport`, `deriveSketchPointFromWorld`, `EDITOR_SKETCH_REFERENCE_PROJECTION_TOLERANCES`)
- [ ] 1.8 Verify all existing tests pass with no import changes

## 2. Unify the effect runtime

- [ ] 2.1 Create `src/application/editor/effect-registry.ts` with `createEffectExecutor(runtime: EditorEffectRuntime): (effect: EditorEffect) => Promise<EditorEvent>` — consolidate the switch statement from `runEditorEffect` in `state-machine-runtime.ts`
- [ ] 2.2 Move `createModelingServiceEditorEffectRuntime` from `state-machine-runtime.ts` into `effect-registry.ts`
- [ ] 2.3 Update `create-app-editor-effect-runtime.ts` to import base runtime factory from the new location
- [ ] 2.4 Make `state-machine-runtime.ts` a thin re-export for `runEditorEffect` plus keep `replayEditorEvents` and `replayEditorEventsWithRuntime` as test utilities
- [ ] 2.5 Verify all existing tests pass

## 3. Create the TEA event loop

- [ ] 3.1 Create `src/application/editor/editor-event-loop.ts` — `EditorEventLoop` class with `dispatch`, `subscribe`, `getState`, `start`, `stop`, serial effect queue processing, error handling via error reporter
- [ ] 3.2 Write unit tests for `EditorEventLoop` — dispatch, effect queue ordering, error handling, subscribe/unsubscribe, start/stop lifecycle
- [ ] 3.3 Create `src/application/editor/use-editor-event-loop.ts` — React hook wrapping `EditorEventLoop` with `useRef`, `useState`, `useEffect` lifecycle
- [ ] 3.4 Update `src/hooks/editor-provider.tsx` to use `useEditorEventLoop` instead of xstate actor — preserve the `{ machineState, state, dispatch }` context shape and document change subscription
- [ ] 3.5 Update `src/domain/editor/runtime-machine.spec.ts` to use `EditorEventLoop` — replace `createEditorRuntimeActor` with event loop instantiation, `actor.send` with `loop.dispatch`, `waitForState` with subscribe-based waiting
- [ ] 3.6 Update barrel exports in `src/domain/editor/` to export `EditorEventLoop` types and factory instead of xstate actor types
- [ ] 3.7 Delete `src/application/editor/runtime-machine.ts`
- [ ] 3.8 Remove `xstate` from `package.json` via `bun remove xstate`
- [ ] 3.9 Verify all tests pass and the app runs correctly

## 4. Split the monolithic reducer

- [ ] 4.1 Define `WorkflowReducer<S>` type in `src/core/editor/state-machine/types.ts` — `(state: S, event: EditorEvent, deps: EditorExtensionDependencies) => EditorTransitionResult | null`
- [ ] 4.2 Create `src/core/editor/state-machine/reducer-sketch.ts` — sketch workflow reducer handling `editingSketch`-specific events: sketch pointer, drag, tool patch, history cursor, annotation, special mode, and sketch-specific tool activation, cancel, commit
- [ ] 4.3 Create `src/core/editor/state-machine/reducer-feature.ts` — feature workflow reducer handling `editingFeature`-specific events: form patches, reference picker, and feature-specific cancel/commit
- [ ] 4.4 Create `src/core/editor/state-machine/reducer-import.ts` — import workflow reducer handling `importing`-specific events: file selected, provider selected, selection patched, commit requested, cancelled, committed, failed
- [ ] 4.5 Create `src/core/editor/state-machine/reducer-section.ts` — section workflow reducer handling `inspectingSection`-specific events: offset updated, flip requested, cleared
- [ ] 4.6 Create `src/core/editor/state-machine/reducer-root.ts` — root reducer with `transitionEditorState` that routes to active workflow reducer then falls back to shared handling (session.started, tool.activated, viewport.*, document.*, effect.*, history.*)
- [ ] 4.7 Update `transitions-core.ts` to re-export `transitionEditorState` from `reducer-root.ts`
- [ ] 4.8 Verify all existing pure reducer tests pass without modification

## 5. Formalize the cursor lifecycle

- [ ] 5.1 Create `src/core/editor/state-machine/cursor-lifecycle.ts` — `advanceCursorPhase(context, trigger)` and `getCursorPhaseAction(context)` functions formalizing the 5-phase lifecycle
- [ ] 5.2 Refactor `continueAfterSnapshotRefresh` in `document-helpers.ts` to use the cursor lifecycle module instead of inline phase checks
- [ ] 5.3 Write unit tests for cursor lifecycle phase transitions
- [ ] 5.4 Verify all existing tests pass

## 6. Cleanup

- [ ] 6.1 Update imports across transition files to use specific modules instead of the `helpers.ts` facade (remove the facade)
- [ ] 6.2 Delete the emptied `helpers.ts` facade file
- [ ] 6.3 Run full test suite and verify no regressions
