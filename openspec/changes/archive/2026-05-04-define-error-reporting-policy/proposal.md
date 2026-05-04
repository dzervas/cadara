## Why

Workbench error notifications and Sentry reporting currently overlap by convention rather than by contract. Some caught defects are only shown to the user, while some expected CAD/domain failures can be reported through shared helpers, making Sentry noisy and incomplete at the same time.

## What Changes

- Define an explicit reporting policy that separates expected user/domain failures from unexpected defects and infrastructure failures.
- Keep workbench notifications presentation-only: showing an error notification SHALL NOT by itself imply Sentry reporting.
- Require caught unexpected workbench failures to be normalized into application errors and reported through the central `ErrorReporter`.
- Require expected CAD/modeling rejections to remain user-visible as diagnostics or notifications without being reported as defects by default.
- Require document history restore failures to be tracked through the central reporter in addition to being surfaced to the user.
- Preserve the uncaught-crash backstop from the Sentry browser SDK and React error boundary.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `application-error-pipeline`: Add the expected-vs-defect reporting policy, reportable history-restore failure behavior, and caller-owned classification rules.
- `workbench-notifications`: Clarify that notification presentation is separate from telemetry/reporting policy.

## Impact

- Affected code: `src/contracts/errors/`, `src/lib/reported-action.ts`, workbench controllers under `src/app/workbench/controllers/`, document/workbench action helpers, editor runtime reporting seams, and existing error/notification tests.
- Affected behavior: user-visible error messages remain visible, but Sentry events are emitted only for reportable failures under the explicit policy.
- No new external dependency is expected; the existing Sentry-compatible reporter remains the telemetry transport.
