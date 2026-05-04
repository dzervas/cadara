## Context

The app already has a central `ErrorReporter`, Sentry-compatible production transport, React render error boundary, editor runtime failure funnel, and typed workbench notifications. The missing contract is classification: callers can show an error notification without reporting, or report a domain rejection as if it were a defect, because no explicit policy says which failures are telemetry-worthy.

The implementation needs to follow existing seams:

- `contracts/errors` owns normalized error shape and reporter contracts.
- `lib/reported-action.ts` owns shared workbench action failure handling.
- Workbench controllers own UI notification decisions because they know whether a failure is expected user feedback or an unexpected defect.
- Presentational notification components stay unaware of Sentry or error classification.

## Goals / Non-Goals

**Goals:**

- Make reportability explicit at the workbench/action boundary.
- Preserve user-visible error notifications for expected CAD and file-flow failures.
- Report caught unexpected exceptions and infrastructure failures through `ErrorReporter` with source, context, cause, and dedupe metadata.
- Track document history restore failures through the central reporter while continuing to surface the restore message to the user.
- Keep Sentry SDK usage isolated behind the existing reporter transport.

**Non-Goals:**

- Do not make every `error` notification a Sentry event.
- Do not add a new telemetry vendor or SDK import path.
- Do not redesign workbench notification UI.
- Do not convert every existing action to neverthrow in this change; focus on the policy seam and representative reportable paths.

## Decisions

### Decision: Classification belongs at the boundary that still has cause context

Workbench controllers and shared action helpers SHALL decide whether a failure is expected or reportable. Notification rendering cannot safely infer this from `type: "error"` because expected states like invalid geometry, unsupported importers, denied browser permissions, and cancelled workflows are often error-presenting but not defects.

Alternative considered: report every error notification. This is simpler mechanically but creates noisy Sentry issues and hides the distinction between user-correctable CAD feedback and application defects.

### Decision: Add a shared workbench failure policy helper

Introduce a small app-layer helper that receives a normalized `AppError`, source metadata, user message, and reporting policy. The helper always updates the configured UI error surface when requested, and only calls `ErrorReporter.report` when the policy says the failure is reportable.

This keeps callers explicit without duplicating reporter metadata construction in every controller.

### Decision: Update `runReportedAction` policy instead of bypassing it

`runReportedAction` already matches the repo's action-funnel shape. It should gain an explicit reportability hook or option so callers can distinguish rejected modeling diagnostics from thrown defects. Existing callers that handle true defects can keep default reportable behavior; expected domain rejections can opt out.

### Decision: History restore failure is reportable

Stored history restore failure indicates saved state could not be replayed or decoded. Even if the document can continue with a user-visible warning, it is a high-value diagnostic and SHALL be reported with document/revision context and diagnostics when available.

### Decision: Notifications remain presentation-only

`WorkbenchNotificationModel` should not gain Sentry/reportability fields. Telemetry classification is an application concern, not a visual component concern.

## Risks / Trade-offs

- [Risk] Expected failures could still be over-reported if callers choose the wrong policy. → Mitigation: make expected-vs-reportable examples explicit in specs and tests.
- [Risk] Under-reporting could hide defects if thrown errors are normalized as expected diagnostics. → Mitigation: require caught exceptions and infrastructure failures to report by default.
- [Risk] Shared helpers can become too generic. → Mitigation: keep the helper focused on workbench failure handling: normalize/report/notify, not broad domain orchestration.
- [Risk] Existing tests may assert reporter counts for modeling rejections. → Mitigation: update tests to assert the new policy rather than preserving noisy behavior.
