## 1. Dependency And Error Contract

- [x] 1.1 Add `neverthrow` to runtime dependencies and ensure Bun lockfile updates cleanly.
- [x] 1.2 Create the shared error module with `AppError`, structured context entries, error codes/severity, `Result` aliases, and helper constructors.
- [x] 1.3 Implement normalization helpers for unknown thrown values, rejected promises, zod failures, modeling diagnostics, and fallback operation errors.
- [x] 1.4 Add unit tests proving normalization preserves human messages, causes, context, request ids, and fallback messages for non-`Error` throws.

## 2. Reporter Pipeline

- [x] 2.1 Add an `ErrorReporter` interface with console and test reporter implementations.
- [x] 2.2 Add reporter metadata for source, visibility, dedupe key, and future external-tracking transport compatibility.
- [x] 2.3 Add a provider or workbench integration point that makes the reporter available to editor/workbench action boundaries without importing UI concerns into domain modules.
- [x] 2.4 Add tests proving reported errors reach console/test transports and duplicate reports are controlled where dedupe metadata is present.

## 3. Editor Runtime Integration

- [x] 3.1 Convert `runEditorEffect` catch paths to normalize unknown failures through the shared error helpers before emitting typed failure events.
- [x] 3.2 Preserve request, document, revision, command session, operation, and target context on editor effect failures.
- [x] 3.3 Add an XState `invoke.onError` safety net for unexpected actor rejections that escaped typed effect conversion.
- [x] 3.4 Add or update editor runtime tests for expected effect failures and unexpected invocation failures.

## 4. Workbench Action Integration

- [x] 4.1 Add a shared `runWorkbenchAction` helper that accepts an operation label, context, async action, success mapping, and UI error callback.
- [x] 4.2 Convert variable add/update/undo/redo actions to the helper and preserve field-specific validation messages.
- [x] 4.3 Convert feature/sketch/body rename, delete, and history cursor actions to the helper.
- [x] 4.4 Convert export or download failure handling to normalize and report through the same pipeline where applicable.
- [x] 4.5 Add component or domain tests proving rejected promises and rejected modeling results update UI-facing error state and report to the reporter.

## 5. Diagnostics And UI Surfaces

- [x] 5.1 Add conversion from `AppError` to `ModelingDiagnostic` for feature, sketch, and preview contexts that have diagnostic targets.
- [x] 5.2 Add or update the workbench notification/status surface so reported user-action errors show a human-readable message.
- [x] 5.3 Add a React error boundary for render-subtree crashes and route caught errors through the reporter.
- [x] 5.4 Add tests proving UI surfaces render normalized messages without losing existing modeling diagnostics.

## 6. Static Enforcement

- [x] 6.1 Enable or add lint enforcement that fails empty catch blocks in application, test, and E2E source files.
- [x] 6.2 Add a dedicated static test if ESLint cannot enforce the "handled, reported, converted, or rethrown" policy strongly enough.
- [x] 6.3 Update existing catch blocks that become violations by reporting, returning a typed error, or rethrowing.
- [x] 6.4 Add regression coverage with at least one fixture or targeted assertion proving an empty catch block fails the guard.

## 7. E2E Coverage

- [x] 7.1 Identify stable erroneous user actions that can be triggered through the workbench UI without test-only internals where possible.
- [x] 7.2 Add Playwright console capture helpers for actionable error records.
- [x] 7.3 Add E2E coverage for at least one erroneous workbench action that asserts UI notification/status output.
- [x] 7.4 Add E2E coverage for at least one erroneous runtime or modeling failure that asserts UI diagnostics and/or console reporting.
- [x] 7.5 Ensure the E2E tests fail when the erroneous action is silent in both UI and console.

## 8. Verification

- [x] 8.1 Run `bun run test` and fix failures.
- [x] 8.2 Run `bun run lint` and fix failures.
- [x] 8.3 Run relevant Playwright E2E tests and document any remaining manual verification gaps.
- [x] 8.4 Review the implementation for direct Sentry/vendor imports outside the reporter transport layer and remove any coupling.
