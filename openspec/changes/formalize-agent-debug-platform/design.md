## Context

The repo already has several useful but disconnected debug seams:

- the workbench state overlay renders current state for humans
- `window.__cadTestState` and `window.__cadSelectTarget` expose narrow dev hooks for Playwright
- the bug-report flow can export compact or full debug artifacts
- the editor runtime already centralizes causal sequencing in `EditorEventLoop`

The missing piece is a coherent dev-only debugging architecture for local development, especially when coding agents run inside Docker and need a supported browser connection path. The easiest implementation path would be to keep extending `CadWorkbench` with more `window` assignments and one-off helpers, but that would violate the repo's existing architecture direction: browser-facing coordination belongs in application-layer modules, command sequencing belongs in the runtime, and the shell should stay render-focused.

This change therefore treats debugging as an architectural concern, not a convenience patch.

## Goals / Non-Goals

**Goals:**
- Give local developers and coding agents a supported dev-only browser debugging workflow.
- Expose a typed debug namespace on `window` without making the workbench shell the owner of that contract.
- Capture event-loop trace data at the runtime boundary so debugging can answer "how did we get here?" rather than only "what state is visible now?".
- Reuse exported debug-session data across local debugging and existing bug-report artifact flows.
- Preserve existing architecture boundaries between shell composition, application controllers, runtime orchestration, and domain or contract code.

**Non-Goals:**
- Shipping any production debug namespace, CDP endpoint, or replay UI.
- Turning the editor runtime into an owner of browser APIs, DevTools transport, or window mutation.
- Replacing Playwright, replacing the existing bug-report flow, or redesigning the workbench state overlay as a major UI project.
- Solving hosted support observability, remote telemetry pipelines, or multi-user debugging.

## Decisions

### Decision: Split the debug platform into transport, application bridge, runtime trace, and artifact layers

The platform will be divided into four layers:

- **Debug-browser transport:** a dev-only Docker or Compose browser endpoint with remote debugging enabled and a persistent browser profile
- **Application debug bridge:** dedicated app-layer modules that install the debug namespace, coordinate browser-facing actions, and compose runtime or workbench state into the exported debug contract
- **Runtime trace source:** passive event-loop observability emitted from `EditorEventLoop` and related runtime seams
- **Artifact layer:** bounded session export structures consumed by local debug flows and bug-report artifact generation

This follows existing repo patterns: browser-facing coordination lives in application wiring, authoritative sequencing stays in the runtime, and reusable data formats live in contracts or domain-adjacent modules.

Alternatives considered:
- Keep all debug wiring in `CadWorkbench`.
  Rejected because the shell would become the default home for new debug coordination logic.
- Push the complete debug bridge into the runtime.
  Rejected because browser transport and `window` lifecycle are not runtime-owned concerns.

### Decision: Runtime tracing SHALL be passive and subscription-based

The editor runtime will expose typed trace events or snapshots as an observer surface around dispatch, transition application, effect enqueue, effect completion, and effect failure. The trace recorder is passive: it does not decide runtime behavior and does not mutate browser state directly.

The important architectural line is:

- runtime owns the causal data
- application code decides whether to publish that data to a debug namespace, overlay, or export artifact

Alternatives considered:
- Log traces directly from the runtime to `window` or `console`.
  Rejected because it couples the runtime to browser globals and weakens testability.
- Derive traces later from React state snapshots.
  Rejected because that loses event/effect causality and timing.

### Decision: Formalize one dev namespace instead of accumulating ad hoc globals

The current `__cadTestState` and `__cadSelectTarget` globals will be replaced by a single typed dev namespace, such as `window.__cadaraDebug`, installed by dedicated application-layer debug bootstrap code.

That namespace will be the supported contract for:

- current structured state
- trace access
- programmatic selection or dispatch helpers
- session export
- replay entrypoints where supported

This keeps machine-facing debugging intentional and typed instead of forcing agents to scrape the DOM or depend on a growing list of unrelated globals.

Alternatives considered:
- Keep adding one-off globals for each need.
  Rejected because that recreates the current fragmentation under a different name.
- Expose debug data only through a visual overlay.
  Rejected because coding agents need structured contracts more than pixels.

### Decision: Dedicated debug browser stays outside the app runtime

The dev browser connection path will be represented as a dedicated local workflow, most likely a Compose sidecar or equivalent launcher with CDP enabled and service-name reachability from the agent container.

The app will not own browser lifecycle, and the runtime will not know whether a human, Playwright, or a coding agent is attached. The app simply exposes a dev-only debug contract once loaded.

Alternatives considered:
- Have each agent launch its own disposable browser process.
  Rejected because it makes browser ownership, persistence, and debugging ergonomics inconsistent.
- Build custom browser transport into the frontend server.
  Rejected because the frontend app is not the right owner for CDP transport.

### Decision: Reuse the bug-report artifact path as a consumer, not the owner, of debug sessions

Structured session export should become a reusable contract that bug-reporting can embed when available. The bug-report feature remains a consumer of that contract rather than the owner of all debugging data shapes.

This keeps local debugging useful before the app is live and avoids contorting the debug platform around GitHub issue prefill constraints.

Alternatives considered:
- Keep trace export private to bug-report generation.
  Rejected because local debugging for developers and agents is the primary use case right now.

## Risks / Trade-offs

- [Trace capture could become noisy or too expensive] → Keep the exported trace bounded with a ring buffer, summarized payloads, and explicit dev-only gating.
- [The debug namespace could become a backdoor for arbitrary mutations] → Expose narrow workflow-oriented operations rather than a generic "run anything" escape hatch.
- [Browser sidecar setup could drift from normal local development] → Keep the sidecar optional and aligned with the existing `frontend` service and Playwright base URL conventions.
- [Replay may be less deterministic for browser-coordinated flows] → Scope initial replay support to runtime-owned command and document sequencing, and mark unsupported browser-only steps explicitly in the session format.

## Migration Plan

1. Add the dev-only browser workflow and document the agent or Playwright connection path.
2. Introduce runtime trace observation hooks and a bounded in-memory recorder.
3. Install a dedicated application-layer debug namespace that composes state, trace, and debug actions.
4. Migrate existing `__cadTestState` and selection helpers to the new namespace and remove the ad hoc workbench-local globals.
5. Extend debug-session export and bug-report artifacts to include session trace data where available.
6. Update targeted tests and architecture guards so new debug behavior continues to respect ownership boundaries.

Rollback is straightforward because the feature is dev-only. The old narrow bridge can be restored temporarily, but the change should not be considered complete while both ad hoc globals and the formal bridge coexist.

## Open Questions

- Whether replay should be introduced in the same implementation pass as export, or staged after the trace and debug namespace are stable.
- Whether the debug browser should be a long-running Compose service by default or a documented optional helper workflow.
- How much of the existing workbench state overlay should consume the new debug platform versus continuing to read directly from local view-model composition.
