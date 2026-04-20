## 1. Notification Model And Presentation

- [x] 1.1 Add a typed workbench notification model for `info`, `warning`, and `error`, including title, message/body, optional action, dismiss callback, and viewport placement support.
- [x] 1.2 Implement a shared compact notification component using Mantine primitives and centralized workbench theme tokens for surface, border, text, icon color, and accent treatment.
- [x] 1.3 Add or reuse mask-compatible icons for the three notification types, including a warning icon if no suitable existing asset is available.
- [x] 1.4 Implement local auto-dismiss behavior so `info` dismisses after 5 seconds, `warning` dismisses after 15 seconds, and `error` does not auto-dismiss.

## 2. Surface Migration

- [x] 2.1 Replace the workbench status overlay with an `info` typed notification while preserving viewport-safe right offset behavior.
- [x] 2.2 Replace the history restore failure overlay with an `error` typed notification and preserve its reset stored history action.
- [x] 2.3 Replace the Sentry ad-block notice with a `warning` typed notification and preserve manual dismissal.
- [x] 2.4 Ensure multiple viewport-local notification surfaces remain vertically separated and readable.

## 3. Tests

- [x] 3.1 Add focused tests for type-specific notification roles, icon/accent hooks, title/body rendering, and dismiss controls.
- [x] 3.2 Add timer tests for 5 second `info` auto-dismiss, 15 second `warning` auto-dismiss, and persistent `error` behavior.
- [x] 3.3 Update affected workbench or Sentry notification tests to assert the typed presentation instead of neutral overlay assumptions.

## 4. Verification

- [x] 4.1 Run `bun run test` and fix failures caused by this change.
- [x] 4.2 Run `bun run lint` and fix failures caused by this change.
- [x] 4.3 Run `bun run build` and fix failures caused by this change.
