## Context

CADara already has the core sketch-tool architecture the change should use: sketch tool modules own drawing behavior, sketch constraint definitions own constraint metadata/target resolution/commit contributions, and the editor session routes active sketch authoring through those registries. A `point` sketch tool module is present today, so implementation should verify and harden its live toolbar/session behavior instead of creating a second point abstraction.

Onshape parity is the external reference for expected behavior. Onshape exposes Point as a sketch tool, and its Coincident tool can align selected lines by making their infinite underlying geometry coincident. CADara will expose this as a dedicated `Collinear` command for clarity, while preserving that underlying geometric rule.

## Goals / Non-Goals

**Goals:**
- Make Point reliably reachable in the sketch editor and prove it commits standalone durable point geometry.
- Add a dedicated `constraintCollinear` tool with metadata, toolbar exposure, target collection, validation feedback, durable records, annotations, and solver support.
- Support local editable line/line, point/line, and multi-target collinearity against the first selected line.
- Support projected/read-only line references when at least one editable local point or line is constrained to that reference.
- Keep target picking, presentation, durable mutation, and solving in their existing layers.
- Cover the behavior primarily in the logic lane, with UI-lane tests only for toolbar or generic rendering contracts that cannot be proven below UI.

**Non-Goals:**
- Do not rename or weaken Coincident behavior.
- Do not add a separate Onshape-compatible "Coincident makes lines collinear" UI path unless needed by existing Coincident tests.
- Do not support curve/curve collinearity for circles, arcs, splines, conics, or text outlines; those are not line-underlying-geometry targets.
- Do not invent point-on-line behavior through finite segment clamping. Collinearity uses the infinite line defined by the selected line target.
- Do not add a new test runner or E2E-only coverage for solver/domain behavior.

## Decisions

1. **Expose `Collinear` as a first-class constraint tool and durable kind.**
   - Rationale: Users expect Collinear to be inspectable as collinearity, especially for separated lines that do not share endpoints. A Coincident alias would make history, annotations, and validation harder to understand.
   - Alternative considered: Map Collinear to Coincident internally. Rejected because existing Coincident has broader curve/point semantics and would blur solver diagnostics and annotation identity.

2. **Treat the first selected line as the reference line for multi-target collinearity.**
   - Rationale: Onshape documents that line selection order changes the result, with later selections constrained to the first selected entity's underlying geometry. This gives predictable behavior for multiple lines and points.
   - Alternative considered: Require exactly two targets. Rejected because it fails the requested Onshape-level behavior and forces repetitive interactions.

3. **Represent supported combinations as line-underlying-geometry relationships.**
   - Local line to local line: constrain both endpoints of the driven editable line to the reference line's infinite geometry, or use an equivalent solver-owned collinear residual.
   - Local point to line: constrain the editable point to the selected line's infinite geometry.
   - Local editable target to projected/read-only line: constrain the editable point or editable line endpoints to the projected/read-only line's infinite geometry.
   - Rationale: This handles non-overlapping lines and point/line cases without requiring shared vertices or segment overlap.
   - Alternative considered: Use finite point-on-segment constraints. Rejected because the user explicitly called out non-overlapping lines and Onshape's infinite underlying geometry behavior.

4. **Keep Point as the existing sketch tool, but harden the reachable behavior.**
   - Rationale: The codebase already has `pointSketchToolDefinition`, point entity factory support, and tests around durable point commits. The implementation should audit toolbar/search exposure, runtime activation, selection/deletion, snapping, persistence, and commit behavior rather than duplicating the tool.
   - Alternative considered: Add a new `sketchPoint` or `vertex` tool ID. Rejected because it creates unnecessary compatibility and UI ambiguity.

5. **Use existing validation and feedback surfaces for invalid targets.**
   - Rationale: Prior sketch constraint work established that unsupported picks must not silently no-op. Collinear should reject unsupported picks through the active constraint authoring feedback path.
   - Alternative considered: Ignore unsupported picks until a valid combination is selected. Rejected because it hides why the operation did not complete.

6. **Put durable behavior tests in the logic lane first.**
   - Rationale: `docs/testing.md` classifies domain/core/contracts behavior under the logic lane. The relevant seams are registry resolution, sketch-session commit contributions, contract validation, solver evaluation, projected references, and invalid-target feedback.
   - Alternative considered: Prove the whole change through E2E. Rejected because browser tests would be slower and less direct for solver/domain contracts.

## Risks / Trade-offs

- **Risk: existing Point behavior is already mostly implemented and the change over-scopes it** -> Start implementation with an audit and only patch missing reachability or contract gaps.
- **Risk: collinear residuals become numerically unstable for degenerate reference lines** -> Reject degenerate lines as invalid or report explicit unsatisfied diagnostics rather than normalizing arbitrary vectors.
- **Risk: projected/read-only references accidentally become editable** -> Model projected lines as read-only operands and only move local editable points/line endpoints.
- **Risk: multi-target target ordering is confusing** -> Keep toolbar prompt and validation copy explicit: first valid line is the reference, later editable points/lines align to it.
- **Risk: annotations/rendering require one-off React branches** -> Prefer the existing generic constraint annotation descriptor/glyph pipeline; only extend descriptor vocabulary if the current schema cannot express Collinear.

## Migration Plan

1. Audit current Point registration, toolbar visibility, search/dropdown behavior, runtime activation, commit output, selection, deletion, persistence, and tests.
2. Add or repair Point exposure/coverage only where the audit finds a missing contract.
3. Add `constraintCollinear` to constraint IDs, metadata, icons/glyphs, resolver rules, preview descriptors, commit contribution creation, and toolbar grouping.
4. Extend sketch contracts and runtime validation with durable collinear records and read-only/projected line operands as needed.
5. Implement solver support for local and projected collinear operands with explicit diagnostics for missing or degenerate references.
6. Add logic-lane tests first; add focused UI-lane tests only for toolbar exposure and annotation rendering if lower-level tests cannot prove them.
7. Run `bun run test:all`.
