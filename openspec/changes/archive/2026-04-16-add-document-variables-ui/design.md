## Context

The current left sidebar renders Parts & Objects, Snapshot References, and Document Diagnostics. Snapshot References are useful implementation data, but the requested workflow needs user-facing document variables in that slot. The durable reference records must remain in the document snapshot for selection, diagnostics, and future feature logic.

The current persistence model stores committed document mutations in operation history and rebuilds the document snapshot from that durable history. Variables therefore need a durable document representation and persistence path, but their expression validation and mathjs-based evaluation are intentionally deferred.

## Goals / Non-Goals

**Goals:**
- Persist document variables with stable identity, user-entered name, and raw user-entered value text.
- Surface variables in the left sidebar where Snapshot References are currently displayed.
- Provide add and edit UI for variables with compact CAD-style controls.
- Allow runtime/UI-only invalid value state to drive red styling without persisting validation results.
- Keep diagnostics visible but constrained to the maximum height of the current diagnostics section.

**Non-Goals:**
- Evaluating variable expressions.
- Validating variable syntax or semantic correctness.
- Wiring variables into feature parameters, sketches, dimensions, or kernel operation logic.
- Removing, renaming, or weakening the underlying snapshot reference contract.

## Decisions

1. Store variable values as raw text, not numbers.

   The future mathjs implementation will need to evaluate expressions, units, and references. Persisting raw text preserves the user's authored input and avoids forcing premature numeric semantics. Alternative considered: store a parsed numeric value now. That would conflict with future expression support and create migration work.

2. Add document variables as durable document data with runtime validation schemas.

   The snapshot should expose `document.variables` as ordered records, and persisted history should include variable add/update mutations so refresh replay restores the variable list. The runtime schema should validate shape, ids, names, and value strings, but not expression correctness. Alternative considered: keep variables in component-local state or a sidebar-only localStorage key. That would make variables disappear from document exports/replay and split document persistence across unrelated stores.

3. Keep invalid variable status outside persisted data.

   The UI can accept a runtime invalid state keyed by variable id and render the value control with danger styling. No `isValid`, `error`, or parsed result should be written to the persisted variable record. Alternative considered: persist validation status with each variable. That would become stale after validation logic changes and contradict runtime re-evaluation.

4. Replace only the visible sidebar Snapshot References section.

   The left sidebar should render Variables in that position. The existing snapshot `references` records and inspection logic remain available to internal systems and future debug/inspector surfaces. Alternative considered: rename or remove reference records from the document contract. That would break durable selection and invalid-reference diagnostics for no user-facing benefit.

5. Constrain diagnostics by max-height rather than hiding diagnostics.

   Document Diagnostics should keep the current normal rendered height as its maximum height and scroll internally when content exceeds that space. This keeps dense sidebar navigation stable while preserving access to all diagnostics.

## Risks / Trade-offs

- Persisting variable mutations before evaluation exists can create variables that look syntactically wrong but are still stored. -> Mitigation: explicitly treat validation status as runtime-only and keep value text editable.
- Adding variable persistence to operation history broadens replay responsibility. -> Mitigation: keep variable mutations simple and independent of kernel geometry rebuilds until variables are used by features.
- The sidebar loses direct visibility into snapshot references. -> Mitigation: preserve reference contracts and callbacks internally; only the standard sidebar section changes.
- Empty variable names may need future validation rules. -> Mitigation: persist raw strings now and leave name/value correctness to future validation work.
