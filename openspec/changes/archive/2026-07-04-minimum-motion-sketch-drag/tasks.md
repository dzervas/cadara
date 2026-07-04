# Tasks

## 1. Fixtures and Baseline

- [x] 1.1 Capture regression fixtures from currently misbehaving drags (reflection flips, refused underconstrained drags, distant-geometry drift) as sketch definitions plus drag paths, using the instrumented solver adapter, before changing solver behavior.
- [x] 1.2 Record current solver benchmark numbers for the 10/50/150-constraint fixtures as the perf baseline. (drag-frame: 10=~0.68ms, 50=~0.79ms, 150=~1.69ms; full-solve unchanged at ~2.5/7.7/54ms.)

## 2. Soft-Target Acceptance (D1)

- [x] 2.1 Split the interactive drag objective into hard terms (authored constraints/dimensions) and soft terms (cursor target), and remove `targetDistance` from every drag acceptance predicate (`createDraggedPointAcceptance`, `createDraggedBranchAcceptance`, translation fast paths).
- [x] 2.2 Accept a drag frame whenever hard constraints are satisfied and the solve converged, returning the best feasible position even when the cursor is unreachable.
- [x] 2.3 Restrict `blocked` results to non-convergent, invalid-program, missing-point, and stale-session cases; keep diagnostics machine-readable.

## 3. Minimum-Motion Regularization (D2)

- [x] 3.1 Add uniform previous-frame anchoring residuals (policy 1) for all non-dragged free points in the affected component, with weight `ε ≪ w_drag` and analytical gradients.
- [x] 3.2 Ensure ε-term anchors update to the last accepted frame within a gesture and reset at gesture start.
- [x] 3.3 Keep the policy-2 (constraint-graph-distance-weighted) code comments adjacent to the regularization weights so the alternative stays discoverable next to the math.

## 4. Continuity: Warm-Start and Substepping (D3, D4)

- [x] 4.1 Route all interactive drags through a per-gesture compiled solve session; eliminate per-frame recompilation via the stateless drag entry point for pointer-move updates.
- [x] 4.2 Subdivide cursor deltas exceeding a step limit into bounded substeps; on non-convergent substeps keep the last accepted frame instead of escalating.
- [x] 4.3 Remove reflected/mirrored branch exploration from interactive drags (`tryExploreDraggedComponentBranches`, `createDraggedComponentBranchSeeds`, `createTwoPointIsometryBranchValues` orientation −1 usage) and delete now-dead code.

## 5. Handle Intent Semantics (D5)

- [x] 5.1 Define the per-handle drag intent contract (point, entity body, circle/arc rim, circle/arc center) at the sketch drag lifecycle seam and map viewport grabs onto it. (`src/domain/editor/sketch-session/drag-intent.ts`; `resolveSketchDragIntent`.)
- [x] 5.2 Remove rigid component translation as a point-drag behavior; regate the translation fast path to entity-body drags or provably rigid components, with result-equivalence to the general minimum-motion solve. (The fast path now runs only inside the substep loop and succeeds solely when whole-component translation satisfies every authored constraint, i.e. provably rigid.)
- [~] 5.3 Implement entity-body drags as identical-delta soft targets on all defining points. (Intent contract expresses the identical-delta `translate` target set; live execution/wiring is deferred until a viewport entity-body grab consumer exists — `beginSketchGeometryDrag` and the solver still take a single point target.)

## 6. Feedback (D6)

- [x] 6.1 Derive constrained-movement feedback from component DOF in the compiled program rather than from failed cursor satisfaction. (A moved-vs-requested ratio only pre-filters candidate frames; the decision comes from `sketchDraggedPointHasFreeDof`, a solver mobility probe on the compiled session, so axis-aligned pulls perpendicular to a free DOF show no feedback.)
- [x] 6.2 Ensure sliding along remaining DOF shows no blocking feedback and that non-convergent gestures keep the last good frame with feedback.

## 7. Tests and Validation

- [x] 7.1 Read `docs/testing.md`; state the chosen lane and seam in commentary before each test edit per the testing policy.
- [x] 7.2 Add logic-lane property tests: (a) accepted frames always satisfy hard constraints; (b) frame-to-frame solution delta bounded relative to cursor delta (continuity, no flips); (c) a drag never blocks when the grabbed target has free DOF; (d) minimality — any non-dragged point that moved was forced by a hard constraint. (`src/contracts/sketch/solver-drag-minimum-motion.spec.ts`.)
- [x] 7.3 Convert the captured misbehavior fixtures into intended-behavior regression tests. (Flip fixtures now assert no-flip continuity; the refused fixed-geometry fixture now asserts satisfiable-no-move; the anchored branch editor fixture asserts continuous non-flip with feedback.)
- [x] 7.4 Re-run solver benchmarks against the baseline from 1.2 and confirm no material regression from the ε-term or substepping. (Benchmark spec passes; 10/50/150 drag-frame times remain sub-2ms.)
- [~] 7.5 Run `podman-compose exec agent bun run test:all` and fix regressions. (lint ✓, `tsc` build ✓, logic ✓ 255, ui ✓ 119, static ✓ 22 via the agent image; Playwright `test:e2e` not run here because it requires the frontend + debug-browser stack.)
