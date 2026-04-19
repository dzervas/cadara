## Why

Production errors currently stop at the local reporter surfaces, which makes deployed failures hard to diagnose after the fact. The existing error pipeline already centralizes normalized failures and anticipates a Sentry-like transport, so this change turns that scaffold into production telemetry with symbolicated stack traces and document context.

## What Changes

- Add a production-only Sentry-compatible reporter transport targeting the Bugsink DSN `https://0f8f70678fa14347ad0d762e7db3c74c@errors.dzerv.art/1`.
- Keep the current console/test reporter behavior for development and tests.
- Attach the current active durable document payload to telemetry events when available, with compact document identity/revision tags for filtering.
- Configure production builds to emit source maps so Bugsink can resolve stack traces to meaningful TypeScript source locations.
- Preserve the existing neverthrow and central reporter boundaries; domain, modeling, editor, and presentational modules must not import vendor telemetry APIs directly.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `application-error-pipeline`: Require production telemetry behind the central reporter, source-map-enabled production builds, and active-document context on reported production errors.

## Impact

- Adds a Sentry browser SDK dependency or equivalent Sentry-compatible transport adapter.
- Updates the central error reporter wiring, likely in `src/contracts/errors/`, `src/hooks/error-reporter-provider.tsx`, and `src/App.tsx`.
- Adds a small active-document context provider or reporter context hook sourced from the editor/modeling state without leaking OpenCascade runtime objects or other transient render data.
- Updates Vite production build configuration to emit source maps.
- Adds or updates focused `bun:test` coverage for production reporter selection, telemetry payload context, dedupe behavior, and source-map build configuration.
