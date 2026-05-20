## 1. Boundary Setup

- [x] 1.1 Confirm the target workbench module path and document the chosen layout in the implementation notes or first migration commit.
- [x] 1.2 Create the dedicated workbench module structure for bootstrap/runtime, controller adapters, commands/use-cases, shell regions, viewport integration, document flows, history flows, and debug integration.
- [x] 1.3 Move workbench feature implementation out of `src/app` so `src/app` only performs application bootstrap and provider composition.
- [x] 1.4 Update imports and static boundary rules so lower layers and reusable components do not import workbench application modules through `src/app`.
- [x] 1.5 Add top-of-file `// SLOP:` ownership comments to any intentionally retained large or convoluted workbench, viewport, controller, or application files.

## 2. Workbench Controller and Commands

- [x] 2.1 Inventory the current `CadWorkbench` inline responsibilities and assign each to shell-local state, controller adapter, named command/use-case, editor runtime, modeling service, or viewport module ownership.
- [x] 2.2 Extract document file actions, tab close/save warning coordination, and document action result handling into named workbench commands/use-cases.
- [x] 2.3 Extract object actions such as rename, delete, export, suppression, and variable add/update into named workbench commands/use-cases.
- [x] 2.4 Extract bug-report/debug and startup/performance bridge wiring into dedicated workbench debug/performance integration modules.
- [x] 2.5 Replace broad controller-return objects with thin React adapters that bind current state to named commands and region action groups.
- [x] 2.6 Split the workbench shell into visible regions that consume prepared models and actions: viewport stage, toolbar, object overlay, inspector layer, document modals, bottom timeline, and tabs.

## 3. Viewport Port Boundary

- [x] 3.1 Define typed `ViewportModel`, `ViewportIntent`, and `ViewportCommand` contracts for the workbench/viewport boundary.
- [x] 3.2 Build a workbench viewport adapter that derives the viewport model from editor/runtime state and translates viewport intents into editor events or workbench commands.
- [x] 3.3 Replace the viewport's large callback surface with the typed intent output and command input path.
- [x] 3.4 Remove hidden `useEditorState` and runtime registry reads from viewport internals by passing required interaction data or capabilities through the viewport model.
- [x] 3.5 Keep camera, controls, projection mode, picking bindings, sketch-plane projection, overlay projection, and render invalidation as explicitly viewport-local state.
- [x] 3.6 Preserve existing viewport behavior for selection, hover, sketch pointer projection, sketch geometry dragging, section handles, view cube navigation, projection switching, LOD changes, and debug projection helpers.

## 4. Tests and Validation

- [x] 4.1 Read `docs/testing.md` before adding or moving tests and record the chosen lane and seam before test edits.
- [x] 4.2 Add or update static architecture coverage for `src/app` bootstrap-only boundaries and prohibited viewport imports of editor/workbench providers.
- [x] 4.3 Add or update behavior coverage at the workbench/viewport seam for typed intents and commands.
- [x] 4.4 Add or update coverage for the `// SLOP:` file-level comment rule only where a static guard is useful and not brittle.
- [x] 4.5 Run `bun run test:all` and fix any lint, build, unit, static, or e2e regressions caused by the architecture change.
