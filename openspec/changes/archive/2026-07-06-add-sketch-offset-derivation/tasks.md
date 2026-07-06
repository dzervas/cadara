## 1. Contract

- [x] 1.1 Add the `offset` kind to `SketchDerivationDefinition` (seed chain, signed distance dimension, joint policy enum, stable output identity mapping) in `src/contracts/sketch/schema.ts`.
- [x] 1.2 Extend the sketch runtime schema and Typia validators; add accept/reject `.spec.ts` cases (logic lane, per `docs/testing.md`).
- [x] 1.3 Define offset diagnostic codes (arc collapse, spline fit failure, chain self-intersection, disconnected chain) alongside existing derivation diagnostics.

## 2. Offset Mathematics

- [x] 2.1 Add characterization `.spec.ts` coverage for current slot-tool offset behavior before refactoring.
- [x] 2.2 Factor the slot offset/trim math from `src/domain/sketch-editing/operations.ts` into a shared offset module consumed by both slot and the new derivation.
- [x] 2.3 Implement closed-form line/circle/arc offsetting with degeneracy detection.
- [x] 2.4 Implement curvature-adaptive spline/bezier offset approximation with the documented tolerance and bounded refinement.
- [x] 2.5 Implement chain orientation normalization and joint resolution (trim/extend at intersections, arc join fallback with stable joint identities).
- [x] 2.6 Add `.spec.ts` coverage: analytic exactness, spline tolerance conformance, all joint cases, every degeneracy diagnostic, closed-loop chains.

## 3. Derivation Recompute

- [x] 3.1 Implement offset recompute in `src/contracts/sketch/derived-geometry.ts` following the mirror/pattern derivation flow, including last-resolvable-state retention on diagnostic failure.
- [x] 3.2 Wire the offset distance into the dimension/expression pipeline (expressions and document variables resolve through `resolveSketchDerivationDistances` and drive recompute). NOTE (v1 boundary): the offset authoring tool currently commits a plain numeric distance (`tools.ts` `offset-distance`/`offset-distance-input` are `kind: "numeric"`); the data model and recompute accept authored expression distances (used by importer-authored payloads), but a post-commit UI path to *rebind* a committed offset's distance to an expression is not yet implemented. See task 6.1.
- [x] 3.3 Add `.spec.ts` coverage: seed edit propagation, distance/expression changes, output identity stability across recompute, diagnostic paths.
- [x] 3.4 Verify derived offset geometry participates in rendering, selection, persistence, and profile extraction like other derived geometry.

## 4. Tool Workflow

- [x] 4.1 Implement the Offset domain tool module (metadata, activation/pointer lifecycle, staged chain selection, side/distance preview, pre-commit validation).
- [x] 4.2 Register the tool in `src/domain/tools/` with toolbar metadata alongside Mirror/Patterns/Transform.
- [x] 4.3 Wire commit through the sketch session to author the offset derivation.
- [x] 4.4 Add logic-lane `.spec.ts` coverage for tool validation and commit preparation; add UI-lane coverage only if preview requires presentation logic beyond the generic tool contract.

## 5. Verification

- [x] 5.1 Confirm slot-tool specs remain green after the shared-math refactor.
- [x] 5.2 Manual smoke: offset an open chain, a closed loop, and a spline-containing chain; exercise arc-collapse and disconnected-selection diagnostics.
- [x] 5.3 Run `bun run test:all`.

## 6. Follow-ups

- [ ] 6.1 Add a post-commit authoring/edit path to bind a committed offset's distance to an expression or document variable in the tool UI, satisfying the UI half of the "Offset distance SHALL be dimensionable and expression-capable" requirement (data model + recompute already support it).
