## Context

The repository already has the contract and adapter scaffolding for `extrude`, `revolve`, `fillet`, and `plane`, plus OCC helper/test coverage that proves much of the kernel-side geometry work for `revolve`, `fillet`, `plane`, and multi-body boolean policy. The remaining gap is that the public feature-editing flow is still almost entirely extrude-specific: the draft/session union only models extrude, feature-session hydration only knows how to load extrudes, and the workbench panel renders a single extrude form with a range slider for depth.

This change spans the modeling contract, OCC adapter implementation, editor state machine, and session UI. It also needs one explicit contract extension because `shell` is not yet part of the `FeatureDefinition` union even though the requested feature set treats it as a first-class solid operation.

## Goals / Non-Goals

**Goals:**
- Add typed contract support for shell and complete OCC-backed behavior for revolve, fillet, shell, plane, and boolean-capable solid feature rebuilds.
- Generalize feature-session draft and hydration logic so create/edit flows work for supported feature types instead of only extrude.
- Replace slider-based dimensional entry with numeric input controls that map directly to typed modeling parameters.
- Keep presentational components thin by building feature definitions and validation from editor/domain helpers rather than from JSX.

**Non-Goals:**
- Introduce advanced feature variants beyond the requested basic set, such as offset/angled plane modes or variable-radius fillets.
- Redesign the overall workbench layout, toolbar taxonomy, or scene interaction model outside the feature-session requirements needed for these features.
- Resolve contract gaps that are already intentionally rejected, such as hidden reconstruction semantics for construction-backed revolve axes.

## Decisions

Extend the feature contract with a first-class `shell` definition instead of hiding shell inside boolean or adapter-specific request state. This keeps the typed contract closed over supported feature kinds, allows snapshots and edit hydration to round-trip shell data, and matches the existing pattern used by extrude, fillet, plane, and revolve. The alternative was to treat shell as an implementation-only mutation path, but that would break the current contract discipline and make edit sessions impossible to hydrate cleanly.

Generalize `FeatureEditSessionState` and its draft map into a discriminated union keyed by feature kind, with one domain helper per feature for defaults, hydration, draft patching, and feature-definition construction. This follows the current `buildExtrudeFeatureDefinition` pattern while keeping feature-specific rules in `src/domain/editor/` rather than in React components or the state machine. The alternative was to create a single loosely typed draft object with optional fields for every feature, but that would weaken TypeScript guarantees and make invalid mixed-feature state easy to create.

Keep preview and commit derivation in the editor/domain layer, not in UI components. The workbench form should emit typed patch events such as "depth changed", "radius changed", or "operation changed", while domain helpers convert the active draft into `evaluatePreview`, `createFeature`, and `updateFeature` payloads. The alternative was to let the panel build feature definitions directly, which would mix contract logic into presentational code and make future CAD behavior harder to test.

Use numeric inputs for dimensional parameters across all feature-session forms. CAD-style feature authoring depends on exact values, and direct number entry maps cleanly to the contract fields already expressed in modeling units. The alternative slider approach is acceptable for demos but does not scale to radii, thicknesses, angles, offsets, or fine-grained edits.

Treat boolean participation as explicit draft state for every boolean-capable solid feature. Extrude already uses `operation` plus `booleanScope`; revolve and shell should follow the same shape so the UI and adapter share one rule: non-standalone operations must keep explicit target-body state. The alternative was feature-specific implicit target inference, but that would conflict with the documented boolean policy and make previews non-deterministic.

## Risks / Trade-offs

- [Generalizing feature sessions touches editor state, modeling service calls, and UI at once] → Mitigate by preserving the current extrude path as the template and extending the discriminated union one feature at a time behind focused tests.
- [Shell expands the public contract surface] → Mitigate by following the existing versioned feature-definition pattern and adding contract examples/tests before relying on UI flows.
- [More feature-specific forms can lead to duplicated JSX] → Mitigate by sharing small presentational controls and keeping feature-specific mapping logic in domain helpers rather than over-abstracting the form layout.
- [Boolean-capable features require target-body selection state that the current form may not fully expose yet] → Mitigate by specifying the draft/state requirements first and allowing an initial constrained UI that only enables commit once explicit scope data is available.
- [Existing OCC tests and current snapshot behavior may only partially cover shell] → Mitigate by adding contract, adapter, and snapshot coverage in the same implementation change so the new feature kind is exercised end to end.

## Migration Plan

1. Extend the modeling contract and examples to add the `shell` feature kind and any related schema/version exports.
2. Generalize feature-session state, hydration, and definition builders so the editor runtime can preview and commit supported feature kinds.
3. Implement or finish OCC adapter handling and snapshot serialization for revolve, fillet, shell, plane, and explicit boolean scope behavior.
4. Replace the extrude-only feature inspector with a feature-kind-aware session form that uses numeric inputs for dimensional parameters.
5. Add focused unit/integration coverage for contract examples, editor session derivation, OCC adapter behavior, and UI form rendering.

## Open Questions

- Whether the first shell UI should support selecting multiple removable faces in one session or should initially constrain authoring to a single selected face while the typed contract still allows more than one.
- Whether plane creation should ship only the currently supported `coplanar` mode in the session form or include visible placeholders for future offset/angle modes.
- Whether boolean target-body picking for revolve and shell should be driven entirely from existing selection state in this change or should receive a dedicated participant picker in a follow-up.
