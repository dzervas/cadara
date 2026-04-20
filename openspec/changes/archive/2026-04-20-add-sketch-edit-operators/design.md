## Context

The repo already has sketch edit tool definitions for trim and offset plus geometry editing operations that sample and mutate supported curves. The requested edit operators overlap in name with part-mode features, so sketch-mode tools must be distinct and operate only on active sketch definitions.

## Goals / Non-Goals

**Goals:**
- Add sketch-mode fillet, chamfer, extend, split, and slot edit tools.
- Provide explicit metadata, selection requirements, validation, preview, and mutation behavior for each operator.
- Preserve active sketch session, sketch-local undo, construction/style conventions, and stable authored references where possible.
- Create slots around selected lines, splines, arcs, or closed profiles using durable related geometry.

**Non-Goals:**
- Change part-mode solid fillet, chamfer, split, mirror, or transform features.
- Add static destructive approximations when durable relationships are needed.
- Implement all possible CAD edge cases in the first pass; unsupported valid cases should return diagnostics.

## Decisions

1. Sketch edit operators get explicit domain definitions.

   Rationale: existing specs already call for edit tools to own activation, selection, validation, preview, and accepted mutation behavior. Adding more metadata-only tools would not be enough.

2. Reuse shared curve sampling/intersection helpers where practical.

   Rationale: trim and offset already need similar geometry operations. Shared helpers reduce duplicated numerical behavior while keeping tool modules small.

3. Slot is treated as a selection-driven edit/generation operator.

   Rationale: the desired behavior creates a slot around selected geometry, not from freehand point placement. It belongs with selection-based sketch operators.

## Risks / Trade-offs

- [Curve splitting and extension can corrupt references] -> Prefer stable references where possible and add diagnostics when preserving references is not safe.
- [Fillet/chamfer across advanced curves may exceed first implementation] -> Support clear first paths and report structured unsupported diagnostics for the rest.
- [Slot around closed profiles can produce ambiguous offset side behavior] -> Define preview and side selection explicitly before accepting the mutation.
- [Existing trim/offset behavior may need hardening] -> Keep fixes scoped to shared helpers required by the new operators.
