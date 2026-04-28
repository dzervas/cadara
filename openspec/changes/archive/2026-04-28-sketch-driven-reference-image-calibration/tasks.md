## 1. Operation Contract And Persistence

- [x] 1.1 Replace operation-local calibration anchor storage with reference-image anchor bindings that persist `anchorId`, label, `u/v`, and bound local `pointId`.
- [x] 1.2 Remove persisted calibration-only constraint state from the reference-image operation contract and runtime schemas.
- [x] 1.3 Update reference-image operation replay, editing, and serialization paths so placement state and anchor bindings survive save, reopen, undo, and redo.

## 2. Calibration Mode Authoring Flow

- [x] 2.1 Rework reference-image calibration mode so placing an anchor creates or binds a local construction point and stores the clicked `u/v` on the image operation.
- [x] 2.2 Update calibration mode panel and viewport interactions to manage anchor bindings, labels, selection, rebinding, and removal without authoring calibration-only constraints.
- [x] 2.3 Ensure exiting calibration mode returns the user to ordinary sketch editing with the bound anchor points still available in the flat graph.

## 3. Solve And Placement Derivation

- [x] 3.1 Add post-sketch-solve placement recovery that computes image placement from solved bound anchor point positions plus stored `u/v` values for locked-aspect and independent modes.
- [x] 3.2 Preserve the last stable placement and surface diagnostics when the solved bound anchors are insufficient, contradictory, or degenerate for the requested fit mode.
- [x] 3.3 Remove or reduce the dedicated calibration solver path so it no longer owns geometric constraint solving for image anchors.
- [x] 3.4 Remove fixed projected anchor-reference export generation and replace any remaining visibility/rendering hooks with sketch-owned bound-point presentation.

## 4. Sketch Workflow Integration

- [x] 4.1 Treat bound image anchor points as ordinary local sketch targets for existing constraint and dimension authoring flows.
- [x] 4.2 Remove calibration-only distance-constraint commands, panel state, and related viewport overlays from the reference-image workflow.
- [x] 4.3 Update deletion and dependency cleanup so removing a bound point or anchor keeps the image operation bindings and flat sketch graph consistent.

## 5. Compatibility And Verification

- [x] 5.1 Implement migration or compatibility handling for legacy reference-image calibration anchors and constraints by materializing bound construction points and surfacing any dropped intent as diagnostics.
- [x] 5.2 Add or update `bun:test` coverage for reference-image operation persistence, calibration mode anchor authoring, solved-placement recovery, ambiguity fallback, and constraint-tool interoperability.
- [x] 5.3 Add regression coverage proving bound anchor points can be constrained through the normal sketch workflow and that ambiguous fits do not collapse or export invalid placement state.
