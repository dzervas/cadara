## Why

Workbench notifications currently share a mostly neutral overlay treatment, so users must read the body before knowing whether a message is informational, cautionary, or a failure that needs action. Differentiating notification types will make transient CAD workflow feedback easier to scan without disrupting the dense dark workbench.

## What Changes

- Introduce typed workbench notifications for `info`, `warning`, and `error`.
- Give each type a distinct but restrained visual treatment using Mantine theme tokens: icon, accent rail, title styling, and accessible role semantics.
- Auto-dismiss `info` notifications after 5 seconds and `warning` notifications after 15 seconds.
- Keep `error` notifications manually dismissed by default so failures remain visible until the user acknowledges them.
- Preserve compact notification placement that avoids the view cube and other viewport controls.

## Capabilities

### New Capabilities

- `workbench-notifications`: Typed workbench notification presentation, dismissal timing, and accessibility behavior.

### Modified Capabilities

- `application-error-pipeline`: User-visible error reporting should surface failures as error-typed workbench notifications when using the notification surface.
- `workbench-ui-foundation`: Notification chrome should follow the centralized dark Mantine theme and semantic color treatment.

## Impact

- Affected UI: workbench status/notification overlays and Sentry ad-block warning presentation.
- Affected contracts: notification type model, dismissal behavior, and error-to-notification mapping.
- Affected tests: focused component/model tests for type styling, accessible roles, and auto-dismiss timing.
- No new runtime dependencies are expected.
