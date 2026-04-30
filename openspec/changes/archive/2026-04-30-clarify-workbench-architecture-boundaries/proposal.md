## Why

The workbench has accumulated too much application orchestration in one place, and the current layering no longer makes ownership obvious. Integration work is now expensive because tool activation, undo/redo, import flows, notifications, and document actions are split across the editor runtime, hooks, and a very large shell component instead of flowing through a small number of clear application boundaries.

## What Changes

- Introduce an explicit application-layer architecture for the workbench that separates shell rendering from orchestration, document actions, and workspace interaction controllers.
- Move toolbar, shortcut, and inspector-triggered command entrypoints onto shared application-owned action paths so one behavior is implemented once and reused everywhere.
- Consolidate non-render workbench orchestration such as undo/redo coordination, import session entry, file menu actions, notification dispatch, and local sync reactions into dedicated controller modules or hooks with narrow responsibilities.
- Define and enforce one-way dependency rules so `app/` remains the composition layer and lower layers do not import from it.
- Preserve existing user-visible behavior for modeling, sketching, import, shortcuts, and history flows while improving code clarity and refactor safety.
- Exclude boot-path and runtime startup refactors from this change.

## Capabilities

### New Capabilities
- `workbench-application-architecture`: Defines application-layer ownership, workbench decomposition rules, and one-way dependency boundaries for orchestration code.

### Modified Capabilities
- `editor-runtime-orchestration`: Tighten ownership boundaries between the editor runtime and application command controllers so command sequencing is not duplicated across workbench code.
- `history-undo-redo`: Require toolbar and shortcut history actions to resolve through one shared undo/redo coordination path instead of parallel implementations.
- `import-toolbar-and-session`: Require generic part import activation and session entry to flow through one application-owned controller path instead of split hook and component orchestration.
- `keyboard-shortcut-workbench-integration`: Require shortcut handlers to invoke the same application command entrypoints used by toolbar actions.

## Impact

- Affected code: `src/app/cad-workbench.tsx`, `src/hooks/use-tool-actions.ts`, workbench shortcut wiring, toolbar action wiring, import session entry, history coordination, and related workbench helper modules.
- Affected systems: editor/runtime integration boundaries, workbench application composition, shortcut execution, tool activation, and local workbench feedback flows.
- Expected outcome: smaller orchestration surfaces, clearer ownership, lower cross-feature coupling, and safer follow-on refactors without changing the boot path.
