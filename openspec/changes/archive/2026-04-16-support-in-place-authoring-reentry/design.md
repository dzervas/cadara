## Context

The workbench already supports hydrated edit sessions for features and supports reopening sketches through defined sketch contracts, but those flows are not exposed through the direct interaction patterns the user expects. Tree interactions still favor selection over edit reentry, and `Escape` behavior is fragmented across active tool state, sketch mode, and picker-specific cancellation paths. This change focuses on entry and unwind behavior rather than on the editor forms themselves.

## Goals / Non-Goals

**Goals:**

- Reopen existing features and sketches through double-click tree interactions.
- Ensure reopened features hydrate the current committed values into the feature form.
- Ensure `Escape` first clears the active tool and exits sketch mode only when no tool remains active.

**Non-Goals:**

- Redesigning the feature form schema or sketch editor UI.
- Changing feature or sketch durable data structures.
- Replacing existing picker-specific `Escape` handling inside feature forms.

## Decisions

### Double-click dispatches explicit reopen intents

The tree presentation layer should emit explicit double-click reopen intents for committed features and sketches. Those intents then reuse the existing session hydration pathways rather than building separate edit-only UI flows.

This is preferable to inferring edit intent from selection timing deeper in the editor layer because the interaction originates in the tree UI.

### Feature reopen reuses existing hydration contracts

Committed feature reopen should flow through the same authoring-definition hydration behavior already used for feature edit sessions. That preserves current values, diagnostics context, and preview readiness without duplicating per-feature logic.

This is preferable to manually pre-filling form inputs in the inspector because form state already has a typed draft lifecycle.

### Escape unwinds local authoring state first

`Escape` should cancel the most local active tool state first. Only when the user is in sketch mode and no tool remains active should `Escape` exit the sketch session. Existing active reference-picker cancellation remains more specific and should continue to take precedence when applicable.

This is preferable to a single global cancel action because the user expectation is layered unwinding rather than abrupt session teardown.

## Risks / Trade-offs

- [Double-click could conflict with existing single-click selection behavior] → Mitigate by keeping single-click selection intact and dispatching reopen only on confirmed double-click.
- [Different feature types may hydrate edit sessions through slightly different paths] → Mitigate by routing all reopen flows through the existing feature authoring-definition hydration contract.
- [Escape precedence could regress active picker cancellation] → Mitigate by keeping picker-specific cancellation higher priority than generic tool deactivation.
