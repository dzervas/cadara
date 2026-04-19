## Context

The app already normalizes failures into `AppError`, routes them through a central `ErrorReporter`, and uses neverthrow at recoverable boundaries. `ErrorReporterProvider` currently creates a console reporter by default, while tests can inject `createTestErrorReporter`. The production build does not yet emit source maps, and no production telemetry transport is wired.

The active document state is available through editor/modeling snapshots. For telemetry, the useful payload is the durable authored document state plus identity and revision tags; transient render exports, OpenCascade objects, preview geometry, and UI-only state are not useful and should not be sent.

## Goals / Non-Goals

**Goals:**

- Report normalized production `AppError` records to the Bugsink DSN through a Sentry-compatible browser transport.
- Preserve development console reporting and injectable test reporters.
- Attach the current durable active document payload, document id, revision id, and compact counts to production error events when a document is loaded.
- Emit production source maps from Vite so stack traces can resolve to TypeScript source locations.
- Keep vendor telemetry imports out of domain, modeling, editor, and presentational code except for a small reporter adapter.

**Non-Goals:**

- Add user-facing error UI beyond the existing error pipeline.
- Replace neverthrow result boundaries with thrown exceptions.
- Add a server-side source-map upload pipeline unless public shipped source maps prove insufficient.
- Capture transient runtime data such as WebGL state, OpenCascade handles, preview renderables, or selection hover state.

## Decisions

1. Add a Sentry-compatible reporter adapter behind `ErrorReporter`.

   The adapter should live with the error contracts, for example `src/contracts/errors/sentry-reporter.ts`, and translate `ErrorReportRecord` into a captured exception or message with tags, fingerprint metadata, structured context, and the original cause when available. This keeps the rest of the app talking to `ErrorReporter`.

   Alternative considered: import Sentry directly in boundaries such as the React error boundary and editor runtime. That would be less code initially but would duplicate reporting behavior and violate the existing central reporter contract.

2. Select the reporter at the provider boundary.

   `ErrorReporterProvider` should keep accepting an injected reporter for tests. Without injection, it should use the console reporter in development/test-like environments and the Sentry reporter in production builds. If a production event also needs local console output later, it can be composed explicitly with `createCompositeErrorReporter`.

   Alternative considered: always initialize Sentry and rely on SDK environment filtering. Explicit production-only selection is simpler to test and avoids accidental development events.

3. Maintain active-document telemetry as ambient reporter context.

   Add a small context writer that lets `EditorProvider` publish the latest loaded document telemetry context whenever the editor view state has a snapshot. The reporter reads the latest context at report time and attaches the durable authored document payload plus compact tags. The document serializer should derive an authored document from the current snapshot so telemetry contains user-authored model state without derived render/runtime fields.

   Alternative considered: pass document context at every `report()` call site. That would be invasive and easy to miss as new boundaries are added.

4. Ship Vite source maps in production.

   Set Vite production build source-map emission in `vite.config.ts`. Because the project is open source and the user explicitly accepts source-map exposure, shipped `.map` files are the smallest deployment change. Release/version tags can use existing build metadata when available, but source-map emission should not depend on a separate upload step.

   Alternative considered: upload source maps to Bugsink/Sentry as a release artifact and hide them from public hosting. That is more operational work and is unnecessary for this open-source deployment goal unless Bugsink cannot resolve shipped maps.

## Risks / Trade-offs

- Large documents may exceed telemetry payload limits -> attach the durable authored document payload when it is serializable and accepted by the SDK; if a hard limit is reached, include identity/revision tags and an explicit marker that the document payload was omitted or truncated.
- Public source maps expose source code structure -> acceptable for this open-source project, and they provide the requested meaningful stack traces.
- Bugsink compatibility may differ from hosted Sentry -> keep the adapter Sentry-compatible and isolate SDK initialization so DSN, transport options, and release metadata can be adjusted in one file.
- Ambient document context can become stale -> update it from the editor provider whenever the loaded snapshot changes and clear it when no snapshot is active.

## Migration Plan

1. Add the Sentry-compatible dependency and reporter adapter.
2. Add active-document telemetry context and wire `EditorProvider` to publish it.
3. Configure Vite to emit production source maps.
4. Add focused tests for reporter selection, event payload context, dedupe behavior, and source-map config.
5. Roll back by switching the production provider back to the console reporter and disabling Vite source-map emission.

## Open Questions

None.
