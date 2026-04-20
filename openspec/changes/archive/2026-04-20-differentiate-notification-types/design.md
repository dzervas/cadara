## Context

The workbench already has several user-visible notification-like surfaces: a right-offset workbench status overlay, a restore-failure overlay with an action, and a top Sentry ad-block notice. They all fit the dark CAD shell, but they do not share a typed presentation model, and severity is mostly inferred from copy or a border color.

The existing theme already exposes dark shell tokens plus warning and danger semantic tokens. The design should use those tokens and Mantine primitives where they keep the implementation smaller, while preserving viewport-aware placement near the view cube.

## Goals / Non-Goals

**Goals:**

- Make `info`, `warning`, and `error` notifications visually distinct at a glance.
- Use a compact dark notification treatment that feels native to the CAD workbench.
- Auto-dismiss `info` after 5 seconds and `warning` after 15 seconds.
- Keep `error` notifications visible until the user manually dismisses them.
- Preserve accessible role semantics and clear title/body hierarchy.

**Non-Goals:**

- Introduce a full global notification queue or third-party toast dependency.
- Redesign unrelated toolbars, sidebars, dialogs, or viewport controls.
- Add success notifications unless a separate workflow asks for them.
- Change the underlying application error reporter contract beyond mapping user-visible failures to error notification presentation.

## Decisions

1. Use a shared typed notification presentation component.

   Existing notifications should converge on a small `WorkbenchNotification`-style component with props for `type`, `title`, `message`, optional action content, and dismissal. This keeps severity styling and accessibility behavior in one place without introducing a speculative notification service.

   Alternative considered: configure Mantine notifications globally. That would add more infrastructure than the current number of notification surfaces requires and would make viewport-aware offsets harder to preserve.

2. Represent severity with icon, accent rail, border, and title color, not bright full-card fills.

   The notification body should stay on the existing dark overlay surface. The type should be denoted by a slim left accent, a small icon, and semantic border/title treatment:

   - `info`: workbench accent token with the existing `info` icon.
   - `warning`: warning token with a warning icon asset.
   - `error`: danger token with the existing `ban` or a dedicated error icon.

   Alternative considered: full yellow/red notification backgrounds. That would be more obvious but too loud for a dense CAD viewport and risks fighting selection/preview colors.

3. Keep dismissal behavior local to each mounted notification.

   `info` and `warning` notifications should start their timer when rendered and clear it on unmount or manual dismiss. `error` uses no auto-dismiss timer by default. This is enough for current surfaces and avoids introducing queue state before it is needed.

   Alternative considered: central notification store with durations. That may become useful later, but it is unnecessary for differentiating the existing surfaces.

4. Preserve viewport-aware placement.

   Workbench viewport notifications should keep using the existing right offset helper so they do not overlap the view cube. The Sentry ad-block notification can remain top-centered because it is app-level rather than viewport-local, but it should use the same typed visual language.

## Risks / Trade-offs

- Timer-based dismissal could make important warning text disappear before a user reads it -> Use 15 seconds for warning, keep manual close, and do not auto-dismiss error.
- Adding another UI component could duplicate Mantine Alert behavior -> Keep the wrapper minimal and use Mantine `Paper`/`ActionIcon` or `Alert` only where it reduces code.
- A new warning icon asset may be needed -> Prefer an existing icon if available; otherwise add one small mask-compatible SVG under the existing icon asset convention.
- Notifications may overlap when multiple existing surfaces render together -> Preserve the current vertical offset behavior and only stack the surfaces involved in this change.

## Migration Plan

1. Add the typed notification model and shared presentational component.
2. Replace the current workbench status overlay with an `info` notification.
3. Replace restore failure with an `error` notification that keeps the reset action.
4. Replace the Sentry ad-block notice with a `warning` notification and 15 second auto-dismiss.
5. Add focused tests for type presentation, roles, and dismissal timers.
