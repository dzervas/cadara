## Workbench Module Layout

The dedicated workbench feature module lives at `src/workbench`.

- `src/workbench/bootstrap`: workbench session host and provider composition.
- `src/workbench/adapters`: React controller adapters that bind current state to workbench commands and UI region actions.
- `src/workbench/commands`: named command/use-case helpers and shared workbench action policy.
- `src/workbench/document`: document file, ownership, tab close, and document-session flows.
- `src/workbench/history`: durable and presentation history helpers.
- `src/workbench/debug`: debug platform and bug-report bridge integration.
- `src/workbench/runtime`: startup/runtime bridge helpers.
- `src/workbench/shell`: visible workbench shell composition and shell-local view helpers.
- `src/workbench/viewport`: the typed workbench/viewport boundary and adapter.

`src/app` is intentionally left empty after this migration. The root `src/App.tsx`
owns browser application bootstrap and mounts the workbench feature module through
`src/workbench/bootstrap/workbench-app.tsx`.
