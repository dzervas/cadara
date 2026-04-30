## Why

The workbench no longer has a single, obvious owner for document-facing state changes. Editor/runtime state, React-local controller state, and direct modeling-service mutations now overlap, which makes integration work brittle because behavior depends on ad hoc refreshes and duplicated sequencing paths instead of one authoritative mutation flow.

## What Changes

- Define explicit ownership boundaries for workbench state:
  - the editor runtime owns command-session state, document refresh sequencing, and mutation request sequencing
  - application-layer controllers own browser-facing coordination, notifications, and command entry mapping
  - the shell owns only UI-local presentation state
- Move document-affecting workbench flows such as rename, variable edits, import commit completion, history navigation, and file-action refresh sequencing onto shared state-ownership paths instead of direct `modelingService` calls followed by ad hoc refresh events.
- Remove duplicate workbench-local document history ownership where the same behavior is already represented by runtime or modeling history state.
- Require workbench controllers to express document mutations through explicit runtime-owned actions or effect requests rather than local hook state plus manual snapshot patching.
- Preserve existing user-visible workbench behavior while reducing hidden state coupling and refresh-order bugs.

## Capabilities

### New Capabilities
- `workbench-state-ownership`: Defines authoritative ownership for shell-local state, application-controller coordination, editor-runtime sequencing, and document mutation flows.

### Modified Capabilities
- `workbench-application-architecture`: Tighten the shell/controller split so the shell does not become an owner of document or command sequencing state.
- `editor-runtime-orchestration`: Clarify that runtime-owned sequencing remains the source of truth for editor command flows and document refresh coordination, while browser-facing coordination stays outside the runtime.
- `history-undo-redo`: Change history behavior requirements so toolbar and shortcut undo/redo resolve through one authoritative sequencing path instead of mixed runtime and workbench-local ownership.
- `import-toolbar-and-session`: Change import-session completion requirements so import review, commit completion, and post-import reopen behavior do not bypass authoritative state sequencing.

## Impact

- Affected code: `src/app/workbench/cad-workbench.tsx`, `src/app/workbench/controllers/*`, `src/hooks/editor-provider.tsx`, editor/runtime integration helpers, and workbench history/import/document action flows.
- Affected systems: editor state ownership, workbench controller boundaries, document refresh sequencing, import completion, rename/update flows, and undo/redo coordination.
- Expected outcome: one authoritative state-ownership model for document-facing workbench behavior, fewer manual refresh bridges, and lower coupling between shell composition and mutation orchestration.
