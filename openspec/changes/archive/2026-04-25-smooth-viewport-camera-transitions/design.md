## Context

The current viewport camera contract mixes user-driven navigation with programmatic jumps triggered by view-cube actions and sketch session framing. Existing specs explicitly describe those programmatic moves as snaps, and sketch entry reframes the camera without any paired rule for restoring the previous workbench view on exit.

This change affects multiple existing capabilities: view-cube navigation, viewport runtime parity, sketch plane alignment, and sketch entry parity. The implementation therefore needs a shared camera-transition approach rather than one-off animation logic in each caller.

## Goals / Non-Goals

**Goals:**
- Make programmatic viewport camera moves visually smooth instead of instantaneous.
- Reuse one transition path for view-cube navigation, sketch entry framing, and sketch exit restoration.
- Capture enough pre-sketch camera state to restore the prior workbench view after leaving sketch mode.
- Keep behavior consistent across all supported sketch entry and exit paths.

**Non-Goals:**
- Changing free orbit, pan, zoom, or pointer interaction semantics during normal manual navigation.
- Persisting camera history across reloads, document changes, or multiple unrelated editor sessions.
- Adding cinematic multi-step camera choreography, custom per-tool easing controls, or new UI settings in this change.

## Decisions

### Use a shared programmatic camera transition controller

All non-manual camera moves should flow through one viewport-level transition controller that accepts a full target camera pose and animates the active camera to it. This avoids duplicating interpolation logic between the view cube and sketch flows and keeps projection preservation, interruption, and final-state reconciliation in one place.

Alternative considered: letting each caller animate the camera independently. Rejected because it would duplicate math, risk divergent easing and completion semantics, and make sketch restore behavior harder to keep consistent with view-cube moves.

### Capture the full pre-sketch camera pose at sketch-session entry

Sketch entry should snapshot the current camera pose before any automatic reframing begins. The snapshot should include the orbit target, orientation, projection mode, and the zoom or distance values needed to reconstruct the prior view accurately for orthographic and perspective cameras.

Alternative considered: deriving a return view from the sketch plane or current scene selection on exit. Rejected because it would not restore the actual user context that existed before entering the sketch.

### Restore the captured pose on every supported sketch exit path

Sketch exit should request a transition back to the captured pre-entry pose regardless of whether the session ends through finish, commit, cancel, abort, or the second-stage `Escape` exit. This keeps the contract simple and predictable: opening a sketch temporarily borrows the camera, and leaving the sketch returns it.

Alternative considered: restoring only when reopening an existing sketch. Rejected because new-sketch entry also reframes the camera and would otherwise leave inconsistent exit behavior across entry points.

### Make programmatic transitions interruptible, with latest request winning

If another programmatic camera request arrives during an in-flight transition, the current animation should retarget from the camera's current interpolated state to the newest requested pose. Manual orbit or pan input should also be able to take control immediately by canceling the in-flight programmatic transition.

Alternative considered: locking camera input until animation completion. Rejected because it would make the viewport feel sluggish and would conflict with normal navigation expectations in a CAD workbench.

## Risks / Trade-offs

- [Restore ignores manual camera changes made during sketch mode] → This is intentional for now because the request is to return to the pre-sketch view; if users later want "restore last in-sketch view" that should be a separate capability decision.
- [Different camera types need different state capture] → Capture a normalized pose shape that stores projection mode plus orthographic zoom or perspective distance so restoration does not depend on ad hoc branching scattered across callers.
- [Animation could interfere with tests that assume immediate camera state changes] → Update tests to wait for transition completion or to assert final state through the shared controller instead of synchronous post-click camera values.
- [Overlapping requests can cause drift or stale completion callbacks] → Centralize cancellation and only commit the latest transition target as authoritative when the animation completes.

## Migration Plan

No data migration is required. Implementation should update the shared viewport camera-control path first, then switch view-cube navigation and sketch entry/exit flows to call that path, and finally update tests to observe animated completion and restored sketch-exit camera state.

Rollback is low risk because the change is runtime-only: removing the transition controller and restoring direct camera snaps would revert behavior without affecting persisted documents.

## Open Questions

- The exact transition timing and easing curve are not user-visible contract details in this proposal. Implementation can choose a single workbench-appropriate default as long as the motion is smooth, interruptible, and bounded.
