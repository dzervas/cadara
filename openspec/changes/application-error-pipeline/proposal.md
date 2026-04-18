## Why

Workbench failures are currently reported inconsistently: some modeling and editor paths produce diagnostics, some workbench actions set local status strings, and other failures can disappear without a UI message or console record. A single typed error pipeline is needed before more feature work and before adding Sentry-like error tracking, so every expected or unexpected failure has a clear path to the user, developer console, and future telemetry.

## What Changes

- Introduce a neverthrow-based `Result` / `ResultAsync` error pipeline with a canonical application error shape carrying human-readable messages, stable codes, severity, cause, request correlation, targets, and structured context.
- Add normalization helpers that convert thrown `unknown`, rejected promises, Zod validation failures, modeling diagnostics, and unexpected runtime failures into canonical application errors.
- Add central reporting boundaries for editor effects, modeling-service-facing workbench actions, and render/runtime fallbacks so feature code does not need local ad hoc `catch` blocks.
- Add an error reporter abstraction that always writes actionable failures to the console in development and can later fan out to a Sentry-like tracker without coupling domain code to a vendor.
- Add UI reporting for user-action failures through the existing CAD workbench notification and diagnostics surfaces.
- Add static enforcement so empty catch blocks are prohibited; every caught error must be handled gracefully, reported, or explicitly rethrown.
- Add basic Playwright coverage for erroneous user flows that verifies failures are visible in the UI and/or reported through the console.
- No breaking API changes are intended for user-facing workflows, but internal async boundaries will start returning or adapting `Result`-style failures instead of relying on raw thrown errors.

## Capabilities

### New Capabilities

- `application-error-pipeline`: Defines the canonical application error contract, reporting boundaries, no-empty-catch enforcement, UI/console reporting expectations, and basic E2E coverage for erroneous actions.

### Modified Capabilities

- None.

## Impact

- Adds `neverthrow` as a runtime dependency.
- Affects editor runtime effect execution, workbench action handlers, modeling service adapters, runtime contract validation helpers, and common test utilities.
- Adds or updates lint rules/tests that fail on empty catch blocks and unreported swallowed errors.
- Adds Playwright tests for erroneous flows, using existing Vite/Bun/Playwright tooling.
- Prepares the codebase for a future Sentry-like error tracking sink through an internal reporter interface rather than direct vendor calls.
