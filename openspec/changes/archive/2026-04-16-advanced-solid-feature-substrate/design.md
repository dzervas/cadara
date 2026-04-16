## Context

The current modeling stack already has the important boundaries in place: feature authoring lives behind feature-owned definitions, preview and commit requests flow through the modeling service, and kernel-specific behavior stays behind the adapter. That foundation is strong enough for the existing basic feature set, but the next requested feature group is broader than a simple list of new toolbar commands.

Sweep, loft, wrap, thicken, enclose, split, delete-solid, face blend, chamfer, hole, external thread, mirror, and transform all require richer target selection and clearer operation intent than the current extrude/revolve/fillet/shell flows. If those features are added one by one without a shared substrate, each feature is likely to invent its own participant names, target-body semantics, preview diagnostics, and OCC rejection behavior.

## Goals / Non-Goals

**Goals:**
- Define common advanced-feature participant vocabulary for profiles, paths, guide curves, faces, edges, bodies, tool bodies, target bodies, planes, axes, and transform references.
- Define a shared operation-intent model for solid-producing and solid-modifying features, including `create`, `add`, `subtract`, and `intersect` where those modes are valid.
- Make advanced feature selection requirements feature-owned and machine-readable so the editor can drive picking, diagnostics, preview readiness, and commit readiness without feature-specific UI branching.
- Keep durable modeling definitions explicit and typed so snapshots, operation history, preview, and rebuild can round-trip the same intent.
- Establish a feature-family roadmap that lets follow-up changes implement a small number of vertical feature slices at a time.
- Require unsupported geometry and kernel gaps to produce explicit diagnostics rather than inferred or silently degraded behavior.
- Require milestone-completion e2e coverage for every implemented advanced feature, matching the expectation already used for extrude and the other existing feature flows.

**Non-Goals:**
- Implement every requested advanced feature in this change.
- Replace the existing feature-owned authoring registry or generic inspector architecture.
- Redesign the toolbar, timeline, feature tree, or Three.js viewport interaction model outside the selection requirements needed for advanced features.
- Define exact OCC construction algorithms for every advanced feature variant.
- Support legacy payload compatibility for feature definitions that do not exist yet.

## Decisions

Define one new substrate capability instead of one proposal per feature. The requested feature list has shared cross-cutting concerns that need common names and rules before individual features can remain small. A single substrate change captures those common rules without pretending to ship the whole feature set.

Keep follow-up implementation changes vertical. After the substrate exists, each follow-up feature should still land as a contract + authoring + adapter + snapshot + test slice, not as UI-only placeholders. This is preferable to implementing all contracts first because CAD feature contracts are easiest to validate when at least one representative kernel-backed path exercises them.

Group the feature roadmap by participant and topology behavior:

```text
Profile/path/surface generators:
  sweep, loft, wrap

Body and region operations:
  thicken, enclose, split, delete-solid

Local topology modifiers:
  face blend, chamfer, hole, external thread

Transform and duplication operations:
  mirror, transform
```

Treat `enclose` as its own high-risk follow-up even though it belongs to body and region operations. It combines faces, profiles, and solids into a region-solving operation and then applies boolean operation intent. That is a larger semantic commitment than a normal modifier and should not be buried in a broad "add missing features" task.

Model operation intent as an explicit field only for features where it is geometrically meaningful. `create`, `add`, `subtract`, and `intersect` are useful for solid-producing features and some body-operation features, but not every feature should expose every mode. The feature authoring definition must declare its supported modes and required participants per mode.

Keep participant roles explicit instead of generic reference arrays. A sweep path, loft profile section, chamfer edge target, split tool body, and mirror plane may all be durable references, but they have different semantics and validation rules. The contract should preserve those roles so snapshots and operation history do not lose authoring intent.

Use feature-owned selection descriptors as the editor-facing bridge. The editor runtime should ask the active feature which participant role is being collected, which target kinds are acceptable, whether the participant is required, whether it allows multiple references, and how missing or invalid references affect preview and commit. This follows the existing authoring registry instead of adding feature logic to presentational components.

Require explicit unsupported-case diagnostics at the modeling boundary. OCC-backed implementations may initially support a subset of valid contract shapes, such as simple sweep profiles or single-tool split operations. They must report unsupported combinations through diagnostics rather than mutating inputs, dropping targets, or guessing alternate topology.

Treat e2e coverage as a milestone completion gate, not as a blocker for the substrate-only change. Each feature slice should add focused unit, contract, adapter, and authoring tests as it lands. Once all advanced features in the milestone are implemented, the milestone is not complete until every implemented feature also has an e2e flow comparable to the current extrude/basic-feature coverage, including tool activation, selection, preview/commit, snapshot/timeline visibility, and a visible geometry outcome or structured rejection where appropriate.

## Risks / Trade-offs

- [The substrate can become too abstract to implement] -> Mitigate by keeping it tied to concrete participant roles and by requiring representative feature slices before treating the substrate as proven.
- [A single substrate proposal can hide too much scope] -> Mitigate by making feature implementation a non-goal and by using follow-up vertical changes for actual feature families.
- [Operation modes differ across features] -> Mitigate by making supported modes feature-declared rather than globally enabled.
- [Kernel support may lag the public contract] -> Mitigate by requiring structured diagnostics for unsupported geometry and by testing rejection paths, not just happy paths.
- [Participant roles may need refinement after the first advanced feature] -> Mitigate by starting with a small proving set such as sweep, chamfer, and split before adding loft, enclose, wrap, and threads.

## Migration Plan

1. Add the shared participant and operation-intent contract types used by future advanced feature definitions.
2. Extend the feature authoring substrate with selection descriptors and diagnostics conventions for advanced participant roles.
3. Add contract and authoring tests that prove representative participant roles can be declared, validated, hydrated, previewed, and rejected without kernel-specific UI imports.
4. Implement the first follow-up feature slices against the substrate, preferably one profile/path feature, one topology modifier, and one body operation.
5. Add milestone-level e2e flows for each implemented advanced feature before declaring the advanced-feature milestone complete.
6. Keep rollback simple by reverting the substrate and dependent follow-up feature slices together if the participant vocabulary proves incorrect before broad adoption.

## Open Questions

- Should `wrap` be grouped with sweep/loft as a profile/path operation, or should it be treated as a projection feature with its own selection substrate?
- Should `transform` support bodies only at first, or should it also support features and sketches as timeline-level transforms?
- Should `external thread` be modeled as a cosmetic/thread annotation first or as a fully geometric solid operation?
- What is the smallest useful `enclose` contract: face-only regions, profile-only regions, or mixed faces/profiles/solids from the start?
