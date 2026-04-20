## Why

The e2e tests in `feature-flow.spec.ts` and `editor-runtime-regression.spec.ts` break frequently because the test harness couples to fragile implementation details: hardcoded viewport pixel coordinates, regex scraping of the full page `textContent` for state extraction, raw PNG byte comparison for canvas stability, and a pointer-retry ritual to work around Three.js hover detection timing. Every small UI change, camera adjustment, or rendering difference cascades into test failures that require manual coordinate and regex tuning. This makes the e2e suite unreliable as a regression gate without reducing the scope of what it actually checks.

## What Changes

- Introduce a structured test-state bridge (`window.__cadTestState`) so tests read machine state, selection, revision, feature session, and preview diagnostics from a typed object instead of regex-scraping `body.textContent()`.
- Introduce a screen-projection bridge (`window.__cadProjectToScreen(objectId)`) so tests resolve 3D geometry targets to viewport pixel coordinates dynamically instead of relying on hardcoded `VIEWPORT_TARGET_POINTS`.
- Replace raw PNG byte-delta canvas stability checks with an app-emitted render-idle signal that the test harness can await directly.
- Introduce a programmatic selection bridge (`window.__cadSelectTarget(targetId)`) for tests that need to select geometry without depending on pointer hover timing — keeping the existing pointer-based path available for tests that specifically exercise picking behavior.
- Move the state debugger overlay out of the viewport pointer-event surface during test runs so the collapse/expand toggle dance before viewport clicks is no longer needed.

## Capabilities

### New Capabilities
- `e2e-test-state-bridge`: Structured dev-only bridge exposing editor state, selection, machine state, revision, feature session, and preview diagnostics to Playwright tests via `window.__cadTestState`, replacing regex-based text scraping.
- `e2e-viewport-projection-bridge`: Dev-only bridge that projects a known topology target ID to viewport screen coordinates via `window.__cadProjectToScreen(objectId)`, replacing hardcoded pixel coordinate maps.
- `e2e-render-idle-signal`: App-level render-idle signal emitted by the Three.js render loop when the scene is stable, replacing screenshot-based pixel-delta polling for canvas frame stability.
- `e2e-programmatic-selection`: Dev-only programmatic selection bridge via `window.__cadSelectTarget(targetId)` that applies a selection through the editor state machine without requiring pointer events, for non-picking-specific tests.

### Modified Capabilities
- `feature-flow-e2e-harness`: Harness methods (`currentEditorSelection`, `featureSessionLabel`, `machineLabel`, `revisionLabel`, `selectReference`, `waitForStableCanvasFrames`) will switch from UI-scraping implementations to the new bridge APIs while keeping the same behavioral assertions.
- `workbench-state-debugger`: Debugger overlay will disable pointer events in test mode so it never intercepts viewport clicks, removing the need for collapse/expand workarounds in the test harness.

## Impact

- **Test harness** (`e2e/helpers/feature-workbench.ts`, `e2e/helpers/sketch-workbench.ts`): Major refactor of state-reading, selection, and stability-waiting methods. All existing test files keep their current assertion structure.
- **App runtime** (`src/components/layout/workbench-state-debugger.tsx`): Conditional `pointer-events: none` in test/dev mode.
- **Three.js viewport** (`src/components/cad/three-cad-viewport.tsx` and render loop): Emit a render-idle custom event or set a `data-render-idle` attribute when the frame loop settles.
- **Editor state hooks**: New dev-only effect that syncs structured state to `window.__cadTestState`. Gated behind `import.meta.env.DEV` or a `cadTestMode` query param so it is tree-shaken from production builds.
- **Selection system**: New dev-only imperative `selectTarget(id)` function exposed on window, calling through the existing editor state machine's selection dispatch.
- **No production bundle impact**: All bridges are dev/test-gated and tree-shaken.
- **No behavioral assertion changes**: Tests continue to verify the same state transitions, feature previews, commits, body presence, and canvas stability — only the mechanism for observing and triggering those states changes.
