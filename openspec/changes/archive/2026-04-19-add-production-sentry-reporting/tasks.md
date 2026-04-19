## 1. Telemetry Reporter Setup

- [x] 1.1 Add the Sentry-compatible browser SDK dependency and update the lockfile with Bun.
- [x] 1.2 Implement a `createSentryErrorReporter` adapter behind the existing `ErrorReporter` contract using the Bugsink DSN.
- [x] 1.3 Preserve dedupe behavior and map `AppError` code, severity, message, cause stack, source metadata, external tracking tags, and fingerprint metadata into the telemetry event.
- [x] 1.4 Add focused `bun:test` coverage for the Sentry reporter adapter using a mocked SDK boundary.

## 2. Reporter Selection and Isolation

- [x] 2.1 Update `ErrorReporterProvider` or a small factory it calls so default development/test reporting remains local and production reporting uses the Sentry adapter.
- [x] 2.2 Keep injected test reporters working without initializing the Sentry-compatible transport.
- [x] 2.3 Add tests proving production selection, non-production local reporting, and vendor SDK import isolation outside the reporter adapter.

## 3. Active Document Context

- [x] 3.1 Add a reporter telemetry-context store or provider that can publish and read the latest active document context without changing every report call site.
- [x] 3.2 Derive the durable authored document payload from the current editor/modeling snapshot and include document id, revision id, schema version, and compact counts.
- [x] 3.3 Wire `EditorProvider` to update the telemetry context when a document snapshot changes and clear it when no snapshot is loaded.
- [x] 3.4 Add tests covering loaded-document attachment, unavailable document context, and serialization or hard-limit fallback behavior.

## 4. Source Maps and Build Configuration

- [x] 4.1 Configure Vite production builds to emit and reference JavaScript source maps.
- [x] 4.2 Add a focused test or config assertion that production build configuration keeps source-map emission enabled.
- [x] 4.3 Run a production build and confirm emitted JavaScript bundles have matching `.map` files.

## 5. Final Verification

- [x] 5.1 Run `bun run test`.
- [x] 5.2 Run `bun run lint`.
- [x] 5.3 Run `bun run build`.
