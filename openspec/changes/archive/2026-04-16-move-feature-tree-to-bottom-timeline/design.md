## Context

The current workbench renders feature-tree rows in `FeatureSidebar`, while `CadWorkbench` owns the overall layout, selection dispatch, hidden-target state, and document snapshot access. The model snapshot already separates durable document records from presentation rows: `KernelDocumentSnapshot.features` carries durable feature records, and `DocumentPresentationSnapshot.featureTree` carries rows used for selection/navigation. Toolbar tooltips are implemented through the shared Radix-backed tooltip primitives used by `ToolButton` and `ToolDropdownButton`.

This change affects both presentation and modeling state. The UI needs a Fusion 360-like bottom timeline that displays committed features as compact icons, and the document needs an explicit cursor that records the last applied feature so rollback can hide or un-apply later features without deleting them.

## Goals / Non-Goals

**Goals:**

- Move feature rows out of the sidebar into a bottom timeline bar while leaving parts, objects, references, and diagnostics in the sidebar.
- Reuse the existing tooltip primitives for timeline feature hover details.
- Represent the current rollback position with a visible timeline cursor.
- Add a document-level cursor that references the last applied feature, defaults to the feature tail, and is used by feature insertion.
- Preserve follow-up features after rollback; inserting a new feature after cursor `b` in `a-b-c-d` produces `a-b-e-c-d` and moves the cursor to `e`.

**Non-Goals:**

- Redesign the top toolbar, feature inspector, viewport controls, or parts/objects sidebar sections.
- Add a complete undo/redo history model or branch visualization.
- Delete or garbage-collect unapplied features as part of rollback.
- Introduce a new tooltip system or new external UI dependency.

## Decisions

### Timeline is a workbench layout component

Create a dedicated bottom timeline component under `src/components/layout/` and mount it from `CadWorkbench` beside the existing sidebar, viewport, and inspector layout. The component receives snapshot-derived feature rows, selection state, visibility state, and cursor data as props, then emits selection/visibility/rollback intents through callbacks owned by `CadWorkbench`.

This keeps layout and editor dispatch near the workbench while keeping the timeline presentational. The alternative of folding the timeline into `FeatureSidebar` would make the sidebar own a control that is no longer visually or behaviorally part of the sidebar.

### Timeline uses durable feature order with presentation details

The timeline should be driven by durable feature order from `snapshot.document.features` and enriched with existing presentation metadata where useful for labels, targets, ownership, and descriptions. Each visible feature uses a single icon with toolbar-sized icon dimensions and reduced vertical padding. Tooltip content should include the feature label and available descriptive/owner details instead of rendering text inline in the bar.

The alternative of reusing the entire feature-tree presentation list would include planes and sketches that are not committed features, which conflicts with the requested feature-only bottom bar. The alternative of adding a separate timeline-only view model to the kernel snapshot is unnecessary unless later requirements diverge from existing feature and presentation records.

### Cursor is document state, not UI-only state

Add a `cursor` field to the model document snapshot contract that references the last applied feature. Use an explicit shape that can represent the tail default and a specific feature reference; the implementation should also define how an empty feature list is represented. Rollback changes the cursor without removing feature records from the document state. Rebuild, render export, and selection surfaces must treat features after the cursor as unapplied.

The alternative of storing rollback position only in React state would fail persistence, replay, and modeling-service consistency. The alternative of deleting later features on rollback would lose document authoring data and contradict the requested insertion semantics.

### Insert after cursor and advance cursor

Feature creation must insert the new feature immediately after the cursor in durable feature order. If the cursor is at the tail, creation behaves like append. If the cursor is rolled back, existing follow-up features remain after the inserted feature. After successful creation, the cursor moves to the new feature.

The alternative of appending to the physical tail while leaving the cursor in place would make feature order inconsistent with rollback authoring expectations. The alternative of truncating later features would delete authoring state.

## Risks / Trade-offs

- [Cursor references a missing feature after deletion or invalid restore] -> Mitigate by validating cursor references in snapshot creation/replay and normalizing to the current tail only through explicit document repair behavior with diagnostics.
- [Existing feature-tree selection paths depend on feature rows in the sidebar] -> Mitigate by moving only feature rows to the timeline and preserving target selection callbacks, visibility controls, and selectable target semantics through the new component.
- [Unapplied feature handling may require changes across render export, diagnostics, and snapshot presentation] -> Mitigate by centralizing applied-feature slicing around the document cursor and covering it with modeling service and adapter tests.
- [A compact icon-only timeline can hide too much information] -> Mitigate by using the existing tooltip mechanics and accessible labels for every feature icon and cursor control.

## Migration Plan

1. Extend the model document snapshot contract with cursor data and update constructors, mock adapters, OCC snapshot assembly, persistence/replay fixtures, and tests.
2. Implement cursor-aware feature insertion and rollback application behavior in the modeling service/adapter layer.
3. Add a bottom timeline component that renders feature icons, shared tooltips, visibility/selection affordances, and the cursor.
4. Remove the feature-tree section from the sidebar while leaving parts, objects, references, and diagnostics sections intact.
5. Add focused tests for sidebar relocation, timeline tooltip/cursor rendering, default tail cursor, rollback preservation, and insertion after a rolled-back cursor.

## Open Questions

- The UI command surface for initiating rollback is not specified beyond the cursor itself; implementation should choose a minimal direct interaction, such as clicking a feature/cursor position, and keep it replaceable.
- Empty-document cursor representation should be explicit in the contract and tests; a nullable feature reference is the likely simplest representation.
