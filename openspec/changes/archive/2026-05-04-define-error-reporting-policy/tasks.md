## 1. Error Policy Helpers

- [x] 1.1 Add an app/workbench failure-policy helper that accepts an `AppError`, source metadata, user-facing message, and explicit reportability classification.
- [x] 1.2 Keep notification rendering presentation-only by ensuring the helper calls UI notification callbacks separately from `ErrorReporter.report`.
- [x] 1.3 Extend or adapt `runReportedAction` so callers can opt expected CAD/modeling rejections out of telemetry while still reporting thrown defects by default.

## 2. Workbench Caller Migration

- [x] 2.1 Migrate reportable caught exceptions in workbench controllers to the shared policy helper with source, cause, context, and dedupe metadata.
- [x] 2.2 Keep expected user/domain failures such as invalid input, unsupported importer, cancelled picker, permission-denied, loading-state, and ordinary modeling diagnostics user-visible without reporting them as defects by default.
- [x] 2.3 Update import, undo/redo, document-file, variable, and feature/sketch action paths so their reporting behavior follows the explicit policy instead of ad hoc `showWorkbenchError` calls.

## 3. History Restore Tracking

- [x] 3.1 Report failed document history restore state through `ErrorReporter` with history-restore source metadata, diagnostic context, document/revision context when available, and a stable dedupe key.
- [x] 3.2 Preserve the existing user-visible restore failure message while avoiding duplicate telemetry for the same document/revision restore failure in one app session.

## 4. Tests

- [x] 4.1 Read `docs/testing.md` before editing tests and choose the correct test lanes for helper, controller, and notification coverage.
- [x] 4.2 Add or update logic/app-controller tests proving expected CAD/modeling rejections notify without reporting by default.
- [x] 4.3 Add or update logic/app-controller tests proving caught unexpected exceptions report through `ErrorReporter` and still show user-facing errors when appropriate.
- [x] 4.4 Add or update coverage proving history restore failures are both surfaced to the user and reported once with diagnostic context.
- [x] 4.5 Add or update notification coverage proving an `error` notification does not itself imply telemetry.

## 5. Validation

- [x] 5.1 Run targeted tests for the edited helper/controller/spec seams.
- [x] 5.2 Run `bun run test:all`.
- [x] 5.3 Run OpenSpec validation for `define-error-reporting-policy` and resolve any artifact issues.
