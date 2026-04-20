## Context

The e2e test harness (`e2e/helpers/feature-workbench.ts`, `sketch-workbench.ts`) drives Playwright tests that exercise the full CAD feature authoring pipeline: fixture setup via seeded `localStorage` operation history, tool activation, geometry selection, feature preview, commit, and post-commit verification.

Currently the harness reads editor state by calling `page.locator('body').textContent()` and regex-matching labels rendered by the `WorkbenchStateDebugger` overlay component. Viewport geometry targets are clicked at hardcoded pixel coordinates. Canvas stability is checked by comparing raw PNG screenshot byte buffers. Hover detection uses a 3-attempt mouse-move ritual with 50ms sleeps. The state debugger overlay captures pointer events over the viewport, requiring a collapse/expand toggle before viewport clicks near the bottom-left corner.

These coupling points cause tests to break on any UI layout change, camera default change, rendering difference, or timing variation — none of which affect the behavioral correctness the tests are meant to verify.

## Goals / Non-Goals

**Goals:**
- Eliminate regex-based `body.textContent()` scraping for state reads by providing a structured in-memory bridge
- Eliminate hardcoded pixel coordinates for geometry selection by projecting target IDs to screen coordinates at runtime
- Eliminate raw PNG byte comparison for canvas stability by exposing a render-idle signal from the Three.js loop
- Provide a programmatic selection path for tests that verify state transitions (not picking behavior)
- Remove the state debugger pointer-event interference during test runs
- Keep all bridges dev/test-only with zero production bundle impact
- Preserve every existing behavioral assertion — same state transitions, same feature flows, same body presence checks

**Non-Goals:**
- Changing what the tests verify (loosening assertions, removing coverage)
- Refactoring the state debugger UI itself beyond pointer-event gating
- Changing the editor state machine, modeling kernel, or feature authoring contracts
- Adding visual regression / screenshot comparison testing
- Changing Playwright parallelism, retries, or worker configuration

## Decisions

### 1. Structured state bridge via `window.__cadTestState`

**Choice:** A single reactive object on `window` updated by a React effect in the workbench root, containing all fields the harness currently extracts via regex.

**Rationale:** The debugger component already receives a `WorkbenchStateDebuggerModel` prop with every field the tests need (`machineState`, `selectionTargets`, `revision`, `featureSession`, etc.). A thin `useEffect` that mirrors this model to `window.__cadTestState` in dev mode gives tests direct access with zero DOM coupling.

**Alternative considered — `data-testid` attributes on each field:** This would still require DOM queries and string parsing for compound values like `selectionTargets`. A single JS object is simpler and faster for `page.evaluate()` calls.

**Alternative considered — custom Playwright fixtures with page.exposeFunction:** This inverts the data flow (page calls into Node) and adds complexity. The window object approach is simpler and keeps the bridge inside the app.

### 2. Screen-projection bridge via `window.__cadProjectToScreen(objectId)`

**Choice:** A dev-only function on `window` that uses the Three.js camera and scene graph to project a named object's world-space centroid to viewport pixel coordinates.

**Rationale:** The app already maintains a scene graph with named meshes keyed by topology IDs. Projecting through `camera.matrixWorldInverse` + `camera.projectionMatrix` then converting from NDC to pixel space is a standard Three.js operation. This replaces the entire `VIEWPORT_TARGET_POINTS` / `VIEWPORT_TARGET_POINTS_BY_ID` / `resolveViewportTargetForPattern` mechanism.

**Alternative considered — embedding coordinates in the fixture data:** This doesn't work because coordinates depend on camera state at render time, not fixture geometry alone.

### 3. Render-idle signal via custom DOM event or data attribute

**Choice:** The Three.js render loop sets a `data-render-idle="true"` attribute on the viewport container when no state transitions are pending and the frame delta is below a threshold for N consecutive frames. Tests await this attribute instead of taking screenshots.

**Rationale:** The app's render loop already knows when it is idle (no pending geometry rebuilds, no animation in progress). Exposing this knowledge as a DOM attribute is trivial and eliminates the expensive screenshot-compare polling loop entirely. A DOM attribute works naturally with Playwright's `waitForSelector('[data-render-idle="true"]')`.

**Alternative considered — custom event dispatch:** Harder for Playwright to await reliably compared to a stable DOM attribute. Events can fire before the test starts listening.

**Alternative considered — keeping screenshot comparison with decoded pixels:** Fixes the byte-comparison bug but doesn't fix the fundamental problem of using visual output as a proxy for render completion.

### 4. Programmatic selection bridge via `window.__cadSelectTarget(targetId)`

**Choice:** A dev-only function that dispatches a selection through the editor state machine's existing selection action, bypassing pointer events entirely.

**Rationale:** Most feature-flow tests don't exercise picking behavior — they exercise state transitions after selection. Programmatic selection is deterministic, instant, and immune to hover timing. Tests that specifically verify picking (like `viewport-solid-topology-picking.spec.ts`) continue using pointer-based selection.

**Alternative considered — improving the hover retry loop:** This treats the symptom (timing) rather than the cause (unnecessary pointer dependency for non-picking tests).

### 5. State debugger pointer-event gating

**Choice:** The state debugger overlay applies `pointer-events: none` when a `cadTestMode` query parameter or `import.meta.env.TEST` flag is set.

**Rationale:** The collapse/expand dance exists only because the debugger's `pointer-events: auto` intercepts viewport clicks. Disabling this in test mode is a one-line CSS change that eliminates the toggle workaround and the race conditions around it.

**Alternative considered — repositioning the debugger outside the viewport:** This changes the dev UX for manual debugging. Pointer-event gating is invisible to non-test usage.

## Risks / Trade-offs

**[Risk] Bridge state goes stale or diverges from rendered UI** → The bridge is updated in the same React render cycle as the debugger component, using the same model object. Divergence is structurally impossible unless the model prop itself is wrong, which would also break the debugger UI.

**[Risk] Projection bridge returns wrong coordinates for off-screen or occluded geometry** → Tests currently use fixtures with known camera angles and simple geometry. The projection function should return `null` for off-screen targets so the harness can fail explicitly instead of clicking the wrong spot.

**[Risk] Render-idle signal fires prematurely before geometry is fully rebuilt** → The idle signal must be gated on both the render loop frame delta AND the absence of pending modeling operations in the state machine. The state machine's `idle` state already encodes this.

**[Risk] Dev-only bridges leak into production bundles** → All bridges are gated behind `import.meta.env.DEV` or `import.meta.env.TEST`, which Vite statically replaces and tree-shakes at build time. A build-size CI check can verify no regression.

**[Trade-off] Tests become less "end-to-end" by bypassing pointer events** → This is intentional and scoped. Feature-flow tests verify state machine transitions, not pointer event handling. Pointer picking tests remain pointer-based. The net coverage is identical; the coupling surface is smaller.
