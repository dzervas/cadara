## 1. XState Runtime Foundation

- [x] 1.1 Add `xstate` and introduce an XState-based editor runtime provider alongside the current custom provider.
- [x] 1.2 Define the initial editor runtime machine/actor structure for idle, selection-command, sketch-editing, and feature-editing workflows.
- [x] 1.3 Preserve the existing modeling-service boundary as the invoked effect surface for snapshot, preview, hydration, and commit work.

## 2. Orchestration Migration

- [x] 2.1 Move session bootstrap and async effect execution out of `useEffect` in `editor-provider.tsx` and into machine-owned lifecycle/invocation behavior.
- [x] 2.2 Port snapshot loading, sketch-open, feature hydration, preview evaluation, and commit flows into invoked actors/services with explicit cancellation behavior.
- [x] 2.3 Preserve current command semantics, stale-response handling, and selection/authoring transitions while removing the old pending-effects queue.

## 3. Verification And Cleanup

- [x] 3.1 Add or update tests covering command-state transitions, async effect ordering, cancellation/stale-response handling, and modeling-service invocation parity.
- [x] 3.2 Remove obsolete reducer/effect-runner orchestration code once the XState runtime reaches parity.
- [x] 3.3 Audit the editor/runtime layer for orchestration-focused `useEffect` that can now be deleted, while keeping legitimate DOM/resource lifecycle effects in place.
