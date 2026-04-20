## 1. Structured State Bridge

- [x] 1.1 Add a `useEffect` in the workbench root (or a dedicated dev-only hook) that writes the `WorkbenchStateDebuggerModel` to `window.__cadTestState` on every render, gated behind `import.meta.env.DEV`
- [x] 1.2 Add a TypeScript global augmentation (`declare global`) for `window.__cadTestState` so both app and test code have typed access
- [x] 1.3 Add a unit test verifying the bridge is populated when the workbench mounts in dev mode

## 2. Viewport Projection Bridge

- [x] 2.1 Implement `window.__cadProjectToScreen(objectId)` in the Three.js viewport component that looks up the scene object by name, projects its world-space centroid through the camera, and returns viewport-relative `{ x, y }` or `null`
- [x] 2.2 Add a TypeScript global augmentation for `window.__cadProjectToScreen`
- [x] 2.3 Add a unit test verifying the projection returns valid coordinates for a known fixture body and `null` for an unknown ID

## 3. Render-Idle Signal

- [x] 3.1 Add logic in the Three.js render loop (or a `useFrame` hook) that tracks consecutive stable frames and sets `data-render-idle="true"` on the viewport container when both the frame delta is below threshold and the editor state machine is idle
- [x] 3.2 Clear `data-render-idle` when rendering activity resumes (state machine leaves idle, new geometry rebuild starts)
- [x] 3.3 Add a unit test verifying the attribute is set after the render loop settles and cleared when a new operation begins

## 4. Programmatic Selection Bridge

- [x] 4.1 Implement `window.__cadSelectTarget(targetId)` that dispatches a selection through the editor state machine's existing selection action, gated behind `import.meta.env.DEV`
- [x] 4.2 Add a TypeScript global augmentation for `window.__cadSelectTarget`
- [x] 4.3 Add a unit test verifying programmatic selection updates `window.__cadTestState.selectionTargets`

## 5. State Debugger Pointer-Event Gating

- [x] 5.1 In `WorkbenchStateDebugger`, apply `pointer-events: none` to the root overlay div when a `cadTestMode` query parameter is present or `import.meta.env.TEST` is set
- [x] 5.2 Remove the `collapseStateDebuggerIfExpanded` / `expandStateDebuggerIfCollapsed` methods from `FeatureWorkbenchHarness` and all call sites in the test harness

## 6. Refactor Test Harness — State Reads

- [x] 6.1 Replace `revisionLabel()` in both `SketchWorkbenchHarness` and `FeatureWorkbenchHarness` with `page.evaluate(() => window.__cadTestState?.revision)`
- [x] 6.2 Replace `machineLabel()` with `page.evaluate(() => window.__cadTestState?.machineState)`
- [x] 6.3 Replace `featureSessionLabel()` with `page.evaluate(() => window.__cadTestState?.featureSession)`
- [x] 6.4 Replace `currentEditorSelection()` with `page.evaluate(() => window.__cadTestState?.selectionTargets)`
- [x] 6.5 Replace `currentPreviewDiagnosticsText()` with a bridge-based read from `window.__cadTestState`
- [x] 6.6 Replace `currentHoverTarget()`, `currentSketchSession()`, and `currentMachineSelectionCount()` with bridge-based reads
- [x] 6.7 Remove the `ensureStateDebuggerExpanded()` call from `openPreservingStorage()` since state reads no longer depend on the debugger being visible

## 7. Refactor Test Harness — Viewport Selection

- [x] 7.1 Replace `VIEWPORT_TARGET_POINTS`, `VIEWPORT_TARGET_POINTS_BY_ID`, and `resolveViewportTargetForPattern` with calls to `window.__cadProjectToScreen()` or `window.__cadSelectTarget()`
- [x] 7.2 Update `selectReferenceThroughCurrentUi()` to use `__cadSelectTarget()` for non-picking tests, falling back to `__cadProjectToScreen()` + click for picking tests
- [x] 7.3 Update `selectSupportedLoftFaceProfile()` to use programmatic selection instead of hardcoded `face1`/`face6` coordinates
- [x] 7.4 Remove the `hoverViewportAtReal()` 3-attempt retry loop from non-picking test paths (keep it for picking-specific tests like `viewport-solid-topology-picking.spec.ts`)

## 8. Refactor Test Harness — Canvas Stability

- [x] 8.1 Replace `waitForStableCanvasFrames()` with `page.waitForSelector('[data-render-idle="true"]', { timeout })` in `reloadPreservingStorage()` and `open()`
- [x] 8.2 Remove `canvasBytes()` and `meanPixelDelta()` from the harness (keep only if the shell visual-stability test in `feature-flow.spec.ts` still needs direct frame comparison)
- [x] 8.3 Update the shell visual-stability test to use `data-render-idle` for the "settle" phase, keeping the pixel-delta assertion only for the explicit "consecutive frames are identical" check

## 9. Verification

- [x] 9.1 Run the full e2e suite (`bun run test:e2e`) and verify all existing tests pass with the refactored harness
- [x] 9.2 Run `bun run build` and verify `window.__cadTestState`, `window.__cadProjectToScreen`, and `window.__cadSelectTarget` are not present in the production bundle
- [x] 9.3 Run `bun run test` and `bun run lint` to verify no regressions
