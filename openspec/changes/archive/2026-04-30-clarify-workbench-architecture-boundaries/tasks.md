## 1. Establish the application architecture boundary

- [x] 1.1 Create the workbench application controller/module structure under `src/app/` for history, tool activation, import entry, document actions, and notification coordination.
- [x] 1.2 Move any shared types or helpers currently imported from `src/app/` by lower layers into appropriate `domain/`, `contracts/`, or `lib/` modules.
- [x] 1.3 Add a regression check that fails when modules outside `src/app/` import workbench application-composition modules from `src/app/`.

## 2. Centralize shared command entrypoints

- [x] 2.1 Implement a shared application-owned tool activation entrypoint and rewire toolbar-triggered and shortcut-triggered tool activation to use it.
- [x] 2.2 Implement a shared application-owned history coordination entrypoint that preserves sketch, workbench-stack, and document-cursor priority.
- [x] 2.3 Implement a shared application-owned generic part import entrypoint that owns picker, provider matching, and import-session startup.
- [x] 2.4 Update `useToolActions`, shortcut wiring, and any other trigger sources to delegate to the shared application entrypoints instead of duplicating orchestration.

## 3. Decompose the workbench shell

- [x] 3.1 Extract document file actions, local file sync reactions, and workbench notification handling from `CadWorkbench` into dedicated application controllers or hooks.
- [x] 3.2 Extract non-render viewport and shell interaction orchestration from `CadWorkbench` into dedicated application controllers or hooks while keeping UI-local state in the shell.
- [x] 3.3 Reduce `CadWorkbench` to application composition, render wiring, and narrow UI-local state with no direct ownership of shared command-family coordination.

## 4. Verify behavior and guardrails

- [x] 4.1 Add or update tests covering shared history entrypoints for toolbar and shortcut parity.
- [x] 4.2 Add or update tests covering shared generic import entrypoint behavior and editor-runtime handoff.
- [x] 4.3 Add or update tests covering shared tool activation parity and the reduced workbench-shell ownership boundary.
