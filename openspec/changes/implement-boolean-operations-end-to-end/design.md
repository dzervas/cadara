## Context

`combine` appears in the part-mode toolbar as a static tool with the tooltip "Boolean selected parts.", but it is not backed by a feature authoring definition and is not part of the current authored feature-kind contract. Other feature tools come from `getRegisteredFeatureAuthoringDefinitions()`, open feature sessions, produce typed feature definitions, and route preview/commit through the modeling service. Combine currently stops at toolbar dispatch and console logging, which makes the UI action look available while producing no durable modeling behavior.

The codebase already has most of the ingredients needed for an end-to-end body boolean: typed participant patterns for advanced solid features, body selectors in form schemas, `operationIntent` values for create/add/subtract/intersect-style features, OpenCascade boolean helpers for fuse/cut/common, render exports with durable body bindings, operation history, and e2e harness expectations for boolean flows. The missing part is a cohesive Combine feature contract that connects those pieces.

## Goals / Non-Goals

**Goals:**
- Make the existing Combine toolbar action start a real feature create session.
- Model Combine as an explicit body-to-body boolean feature with target bodies, tool bodies, and an operation mode.
- Support preview, commit, edit hydration, history serialization, snapshot rebuild, viewport rendering, and object/feature tree updates.
- Surface structured diagnostics for incomplete input, invalid target roles, empty boolean results, missing/stale body references, and unsupported kernel cases.
- Verify through focused unit/contract/kernel tests and one UI e2e flow that Combine changes geometry and persists after rebuild.

**Non-Goals:**
- Redesign the feature inspector or toolbar layout.
- Change existing extrude, revolve, shell, sweep, loft, or thicken boolean operation semantics.
- Add a separate low-level direct-edit command path that mutates selected bodies outside the feature timeline.
- Implement pattern tools, Move Face, Measure, or Section View while touching nearby toolbar no-op entries.
- Add a new geometry/kernel dependency.

## Decisions

Model Combine as a feature, not a direct command. A direct command would feel quicker for a selected-body shortcut, but it would bypass the feature timeline, edit hydration, operation history, and rebuild path that every durable modeling mutation now uses. A registered feature authoring module is consistent with the existing feature tool architecture and gives the user a visible form for operation mode and participant roles.

Use an advanced-solid-style payload with explicit participants. Combine should have `targetBody` and `toolBody` roles plus an operation intent constrained to `add`, `subtract`, and `intersect`. Reusing participant-role semantics avoids inventing a one-off reference array where "first selected body" means different things per operation. Implementation can expose the tool as `combine` in `AuthoredFeatureKind`, `AdvancedSolidFeatureKind`, runtime schemas, and authoring registry.

Keep operation naming aligned with advanced feature intents in the UI form. The underlying OCC helper can map `add` to `join`/fuse, `subtract` to cut, and `intersect` to common. Using advanced operation intent names lets Combine share form and validation patterns with sweep/loft/thicken while preserving the existing basic-feature `FeatureBooleanOperation` names internally where helpers expect them.

Preserve target identity and consume tool-body outputs according to explicit policy. For `add` and `subtract`, the primary result should preserve the first target body identity where possible, matching the existing multi-body boolean policy. Tool bodies that are consumed by the Combine feature should no longer appear as independent unchanged committed outputs unless the operation intentionally creates a separate result. `intersect` may return one or more target-scoped outputs; empty intersections must return diagnostics instead of silently leaving geometry unchanged.

Reuse the existing feature inspector and selection plumbing. The Combine authoring definition should declare form schema fields, selection filters, patch keys, missing-input diagnostics, and draft-to-definition conversion without special React branches. Selection from the viewport should apply to whichever role is active in the form; if no role is explicitly active, the authoring definition can conservatively fill target bodies first and tool bodies second only when that behavior is covered by tests.

Treat mock-kernel behavior as contract-valid but visibly non-noop. The mock adapter does not need exact OCC topology, but it must accept valid Combine definitions, produce changed render/snapshot output, and reject invalid definitions with the same diagnostic shape. This keeps unit and UI tests useful in environments where OCC is not the active adapter.

## Risks / Trade-offs

- [Ambiguous body selection order] -> Mitigation: require explicit target/tool role fields in the form and keep any auto-fill behavior deterministic and test-covered.
- [Boolean output can be empty or split into multiple solids] -> Mitigation: define diagnostics for empty results and preserve a deterministic result naming/identity policy for multi-result shapes.
- [Consumed tool bodies may leave stale tree or viewport entries] -> Mitigation: rebuild object-tree and render exports from the post-feature kernel state, and add tests that assert tool bodies are not still shown unchanged after commit.
- [Advanced feature contract expands a closed union] -> Mitigation: update TypeScript types, runtime schemas, operation-history validation, feature authored-value helpers, snapshot hydration, and adapter capability lists in the same implementation slice.
- [OCC topology naming can invalidate downstream references] -> Mitigation: reuse existing topology history invalidation helpers and surface invalid references as diagnostics during rebuild instead of remapping silently.

## Migration Plan

1. Add Combine to the contract and schema unions behind the existing feature schema version approach.
2. Register `combineAuthoringDefinition` and remove the standalone static toolbar entry so toolbar metadata has one source of truth.
3. Implement preview/commit/rebuild in mock and OCC adapters, then wire render/object-tree outputs from rebuilt state.
4. Add tests from contract outward: schemas and authoring, modeling service history/snapshot behavior, OCC boolean execution, and e2e UI coverage.
5. Rollback can remove the Combine authoring registration and schema additions before any persisted Combine feature ships; after persisted features exist, rollback requires a migration or explicit unsupported-feature diagnostic.

## Open Questions

- Whether Combine should support multiple target bodies and multiple tool bodies in the first implementation, or require exactly one target and one tool body while keeping the payload shape ready for ordered collections.
- Whether `add` should preserve every consumed tool body as hidden historical inputs for edit clarity, or only as references inside the committed Combine feature definition.
