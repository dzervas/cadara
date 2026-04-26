## Context

The editor already carries a shared `selection` array, command-scoped `selectionFilter`s, sketch-session edit-tool state with `selectedTargets`, and feature authoring definitions that own `selectionFilter`, `createDraft`, and `applySelection`. Even so, activation paths are inconsistent:

- `Sketch` and feature activation inspect at most the first selected target.
- sketch edit tools such as `offset` already support accumulating multiple selected targets after activation, but activation always starts from an empty edit-tool state.
- invalid selections are currently carried into the newly activated command/session instead of being cleared as part of activation.

This change is cross-cutting because it touches toolbar-triggered tool activation, runtime selection validation, sketch-session edit-tool bootstrapping, and feature-session creation. It also needs to preserve the existing boundary that selection semantics belong to tool/feature domain definitions rather than presentational components.

Assumptions:

- Empty selection remains a normal activation path; only incompatible non-empty selections are cleared.
- A preselection is considered reusable when every selected target is accepted in order by the destination tool's existing selection rules, even if the tool still needs more input afterward.
- Selection order remains meaningful for multi-slot feature workflows and multi-target sketch edit tools.

## Goals / Non-Goals

**Goals:**

- Reuse valid current selection when activating `Sketch`, selection-driven sketch edit tools, and supported feature create flows.
- Clear incompatible current selections during activation instead of carrying stale targets into the new workflow.
- Keep feature-specific validation and draft application inside feature authoring definitions.
- Keep sketch edit-tool validation and preview behavior inside sketch-session domain logic.

**Non-Goals:**

- Redefining per-feature selection rules or changing durable modeling contracts.
- Introducing preselection reuse for tools that do not consume geometry selections.
- Persisting any new selection metadata in the document model.
- Changing hover, empty-click clear, or Escape-clear behavior outside activation-time handling.

## Decisions

1. Add a shared activation-time selection adoption step in the editor runtime.

   The runtime should validate the current selection against the destination tool's existing `SelectionFilter` before it creates the next command/session state. The adoption helper should replay the current ordered selection through the existing selection-candidate logic and return one of two outcomes:

- adopt the full current selection because every target is valid in sequence
- reject the current selection and activate the tool with an empty selection

   This keeps toolbar activation, keyboard shortcuts, and any future command entry surfaces consistent because they all already flow through `tool.activated`.

   Alternative considered: let each toolbar handler or tool module inspect global selection independently. That would duplicate selection semantics and create drift between activation paths.

2. Treat invalid preselection as all-or-nothing during activation.

   If any currently selected target is incompatible with the newly activated tool, the runtime should clear the full selection rather than keeping a valid prefix. That matches the requested behavior and avoids ambiguous partial carry-over where the user cannot easily tell which prior picks were retained.

   Partial but valid preselection remains allowed. For example, one accepted split seed or several accepted offset edges may be adopted even when the tool still needs more user input after activation.

   Alternative considered: keep the longest valid prefix and silently drop the rest. That is harder to explain, harder to test, and conflicts with the explicit “if invalid, clear the selections” requirement.

3. Reuse existing feature authoring semantics by replaying adopted targets into session creation.

   Feature authoring definitions already own `selectionFilter`, `createDraft`, and `applySelection`, but `createFeatureEditSession` currently accepts only one `selectedTarget`. The least disruptive change is to let feature-session creation accept an ordered `selectedTargets` array, seed the initial draft from the first target as today, and then replay the remaining adopted targets through `applySelection`.

   This keeps selection ownership in feature authoring definitions, preserves ordered multi-slot semantics, and avoids introducing a separate activation-only feature heuristic layer.

   Alternative considered: expand every feature definition with a separate `adoptSelectionOnActivate()` hook. That would duplicate `applySelection` logic without adding meaningful flexibility.

4. Seed sketch edit tools through their existing session-owned selected-target state.

   `offset` and the other sketch edit tools already maintain `selectedTarget`/`selectedTargets` plus preview/validation state in `activeEditTool`. Activation should therefore accept optional initial selected targets, validate them against the edit tool's metadata/accepted target kinds, and build the initial preview using the same domain logic used after manual selection.

   This is especially important for `offset`, which already behaves as a multi-target edit workflow after activation and should simply start with the compatible preselected entities already loaded.

   Alternative considered: synthesize fake viewport-click events after activation. That would entangle activation with pointer semantics and make invalid-selection clearing less explicit.

5. Keep `Sketch` start activation special-cased but driven by the same adoption helper.

   `Sketch` is still different from other tools because a valid adopted selection may open a sketch immediately instead of merely seeding a command. The runtime should still validate preselection through the shared adoption helper, then:

- reopen or open sketch mode immediately when exactly one valid sketch-start target was adopted
- clear selection and enter normal sketch-start selection mode when the prior selection was incompatible

   Alternative considered: leave `Sketch` on bespoke logic and only apply the new adoption flow to features/edit tools. That would preserve one of the most visible reselection annoyances and keep activation behavior inconsistent.

## Risks / Trade-offs

- Existing feature-session code and tests assume a single `selectedTarget` at activation time. → Contain the churn by evolving session creation at one boundary and preserving the current per-feature `createDraft`/`applySelection` contracts.
- Ordered selection replay can expose latent assumptions about target ordering for complex features. → Add focused tests for at least one multi-target sketch tool and one multi-slot feature flow, and keep replay order identical to the current selection order.
- Sketch-session-owned targets such as local sketch entities are not validated the same way as durable document targets. → Reuse the existing sketch edit-tool validation logic instead of routing sketch-local activation through document-only selection catalogs.
- Clearing invalid selections on activation is a behavior change that some users may notice. → Limit clearing to non-empty incompatible selections and keep empty activation behavior unchanged.

## Migration Plan

No document or persisted-data migration is expected. Rollback is limited to restoring the previous activation paths for sketch start, sketch edit tools, and feature session creation.

## Open Questions

- Whether any supported feature tools should intentionally opt out of activation-time preselection reuse even when their authoring filter accepts the current selection.
- Whether the UI should surface a lightweight notification when activation clears an incompatible prior selection, or whether silent clearing is sufficient.
