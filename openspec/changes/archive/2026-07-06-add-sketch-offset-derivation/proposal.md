# Add Sketch Offset Derivation

## Why

Cadara's sketch layer has derived relationships for mirror, linear pattern, circular pattern, and transform, but no offset: there is no way to author "this chain of curves, offset by distance d, staying associative when the masters move." Offset is a core sketcher operation in every parametric CAD (walls, clearances, shell profiles) and its absence is currently the single confirmed sketch-vocabulary gap blocking high-fidelity Onshape import — the import spike found 16 OFFSET constraints across two real documents, encoded exactly as a master→derived relationship with per-entity side flags, i.e. the same family as cadara's existing derivations.

This is a cadara-domain feature, not a kernel question: sketches never touch OCCT, and the raw ingredients already exist in the sketch-editing domain — the slot tool already performs two-sided curve offsetting, `OffsetCurveDescriptor` covers line/circle/arc/spline, and trim-intersection machinery handles joints. What is missing is the durable derivation kind, the associative recompute, spline offset approximation, and the authoring workflow.

## What Changes

- Add an `offset` kind to the sketch derivation contract: seed entity chain, signed/sided offset distance, per-joint policy, and stable derived output identities.
- Add associative recompute: derived offset geometry updates when seed geometry or the offset distance changes, with structured diagnostics when the relationship becomes unsatisfiable (e.g. arc radius collapse) instead of silent detachment.
- Add closed-form offsetting for lines, circles, and arcs, and approximation-based offsetting for splines/beziers with an explicit tolerance policy.
- Add joint handling between adjacent offset segments: trim/extend at intersecting joints, arc join where offsets do not intersect.
- Add the sketch-mode Offset operator tool (selection of a connected chain, side/distance preview, dimensionable distance supporting expressions).
- Reuse and factor the existing slot-tool offset math rather than duplicating it.

Out of scope: offsetting projected/external reference geometry as masters (depends on external-reference target selection semantics; recorded as a follow-up), 3D/part-mode offset features, and any Onshape import behavior (the importer consumes this capability in its own change).

## Capabilities

### Modified Capabilities

- `sketch-derived-transform-operators`: Offset joins mirror/pattern/transform as a first-class derived operator — availability in sketch mode, durable relationship authoring, seed-edit recompute, and workflow participation (render/select/profile) extend to offset, plus offset-specific requirements for curve-type support, side semantics, joint handling, and dimensionable distance.
- `sketch-tool-definition`: Offset gets its own domain tool module with toolbar metadata, activation/pointer lifecycle, staged preview, and validation, consistent with existing sketch tool definitions.

## Impact

- Affected code: `src/contracts/sketch/schema.ts` (`SketchDerivationDefinition` union), `src/contracts/sketch/runtime-schema.ts` (offset distance invariant), `src/contracts/sketch/offset-geometry.ts` (new shared offset/joint math module, consumed by both the contract-layer recompute and the domain operators), `src/contracts/sketch/derived-geometry.ts` (offset recompute), `src/domain/sketch-editing/operations.ts` (slot math refactored onto the shared module plus the offset derivation contribution builder), tool registration and mutation contract in `src/core/sketch-edit-tools/`, sketch session wiring in `src/domain/editor/sketch-session/`, and offset payload normalization in `src/domain/modeling/modeling-service/normalization.ts`.
- Affected APIs/contracts: sketch contract union extension (additive), derived-geometry evaluation, sketch tool registry. No modeling-kernel or worker-protocol changes.
- Dependency impact: none; pure TypeScript, no OCCT involvement.
- Performance impact: offset recompute runs post-solve like other derivations; spline approximation is bounded by tolerance and fit-point count. Solver benchmarks unaffected (offset outputs are not solver unknowns).
- Testing impact: logic-lane `bun:test` for offset math (closed-form curves, spline approximation tolerance, joints, degeneracies) and derivation recompute; UI lane only if the tool needs presentation-contract coverage beyond existing generic tool tests.

## Assumptions and Open Questions

- **Interpretation chosen:** offset outputs are derived (recomputed from masters post-solve), not solver unknowns coupled through constraints. This matches the existing mirror/pattern/transform architecture and Onshape's own encoding. The alternative — full constraint coupling so users can constrain *onto* offset outputs and back-drive masters — is heavier solver work and deferred; constraining onto derived outputs keeps whatever support derived geometry has today.
- **Assumption:** per-entity side flags (Onshape `halfSpace LEFT/RIGHT`) normalize to a single signed distance per chain plus consistent orientation traversal. If real chains require genuinely mixed sides, the contract's per-joint policy field is the extension point.
- **Open question:** joint policy default — trim/extend with arc-join fallback is proposed; whether to expose the policy in the tool UI in v1 or hardcode the default is an implementation-time decision.
- **Open question:** whether closed-profile offsets that self-intersect at the chosen distance should fail with a diagnostic (proposed for v1) or auto-cull loops (industry behavior, significantly more work).
