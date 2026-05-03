## 1. Debug Browser Workflow

- [x] 1.1 Add a dedicated dev-only debug-browser workflow for local Docker development, including a documented browser attach path for agents and humans.
- [x] 1.2 Update local automation configuration so containerized agent workflows can reach the frontend and the debug browser through stable development addresses.

## 2. Runtime Trace Platform

- [x] 2.1 Add passive trace observation hooks to the editor event loop for dispatched events, emitted effects, completions, and failures.
- [x] 2.2 Implement a bounded debug-trace recorder that can summarize recent runtime activity without changing runtime sequencing behavior.

## 3. Application Debug Bridge

- [x] 3.1 Add dedicated application-layer debug modules that compose structured workbench state, trace access, and supported debug actions into one dev namespace.
- [x] 3.2 Migrate existing ad hoc `window` debug globals onto the formal dev namespace and remove the inline workbench-local bridge wiring.
- [x] 3.3 Keep the workbench shell render-focused by consuming the composed debug bridge instead of owning browser debug bootstrap logic directly.

## 4. Session Artifacts And Verification

- [x] 4.1 Extend developer debug-session export and bug-report artifact generation to include bounded trace data when available.
- [x] 4.2 Add or update focused logic, UI, static, and e2e coverage for the runtime trace recorder, debug bridge, and dev-only gating.
- [x] 4.3 Validate the completed change with the full local verification flow, including `bun run test:all`.
