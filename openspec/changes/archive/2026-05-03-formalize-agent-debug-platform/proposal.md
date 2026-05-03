## Why

Debugging is currently split across a viewport state overlay, ad hoc `window` globals, bug-report artifact generation, and tool-level console logging. That gives developers snapshots of state, but not a supported dev-only workflow for coding agents in Docker to attach to a browser, inspect causal event flow, and export or replay a session without pushing more random debug functions into the workbench shell.

## What Changes

- Define a dev-only debug platform for local development that combines:
  - a dedicated debug-browser workflow for humans and coding agents
  - a typed browser `window` debug namespace
  - editor-runtime event and effect trace capture
  - session export and replay inputs for reproducible debugging
- Replace ad hoc workbench-local debug globals with application-owned debug bridge modules that compose runtime state, trace data, and browser-facing actions without making the shell or runtime own the wrong concerns.
- Add passive observability hooks to the editor runtime so event, effect, and accepted-state sequencing can be inspected without moving browser APIs, CDP transport, or window mutation into the runtime layer.
- Extend developer-facing debug artifacts so exported local debug sessions can include the structured runtime trace and related session metadata when available.
- Keep the entire platform dev-only or test-only. No production debug browser endpoint, debug namespace, or replay surface is introduced.

## Capabilities

### New Capabilities
- `developer-debug-platform`: Defines the dev-only browser attach workflow, typed debug namespace, trace access, and session export or replay contract for local developers and coding agents.

### Modified Capabilities
- `editor-runtime-orchestration`: Add passive runtime observability requirements so command and effect sequencing can be traced without transferring browser ownership into the runtime.
- `workbench-application-architecture`: Require debug bridge bootstrap and browser-facing debug coordination to live in dedicated application-layer modules rather than inlined workbench-shell helpers.
- `e2e-test-state-bridge`: Evolve the existing state-only window bridge into a formal dev debug bridge that remains usable by Playwright and coding agents.
- `github-bug-reporting`: Allow developer-generated debug artifacts to include structured session trace data when available.

## Impact

- Affected code: `docker-compose.yaml`, `Dockerfile.agent`, `playwright.config.ts`, new application-layer debug modules under `src/app/` or `src/hooks/`, `src/application/editor/editor-event-loop.ts`, workbench debug bridge wiring in `src/app/workbench/cad-workbench.tsx`, and debug artifact generation under `src/domain/bug-reporting/`.
- Affected systems: local Docker development workflow, browser automation entrypoints, editor runtime observability, dev-only debug exports, and Playwright or agent test utilities.
- Expected outcome: a stable debug surface for coding agents and local developers that follows existing ownership boundaries instead of extending the current ad hoc globals and shell wiring.
