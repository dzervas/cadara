## Context

The workbench already exposes a bottom-left viewport debug panel with machine, command, selection, sketch, feature session, revision, diagnostics, and selection-detail values. Related state is also repeated in the feature sidebar footer as "Editor Session", in the feature tree header as active mode and selection filter, and in the feature inspector header as contract/revision details. These readouts are useful for development, but spreading them across the layout makes the sidebar and inspector heavier and makes it harder to see the complete active selection/tool state in one place.

The existing state sources are sufficient: `useEditorState()` exposes machine/editor state, `CadWorkbench` already derives visible selection and selection detail from the snapshot, and feature authoring state already carries selection filter requirements through the selection/filter contracts. The change should consolidate presentation without introducing new editor state-machine or modeling-service contracts.

## Goals / Non-Goals

**Goals:**

- Provide one bottom-left overlay that summarizes current workbench state for selection, tool/command, sketch session, feature edit session, preview/session, snapshot revision, diagnostics, and selection detail.
- Include the active selection filter label, requirement descriptions, and target slot counts in that overlay.
- Let users collapse and expand the debugger without changing document, editor, selection, or command state.
- Remove duplicate debugger-only readouts from the feature sidebar header/footer and feature inspector header.
- Preserve feature tree/object selection, feature editing controls, sketch tooling overlays, and viewport interactions.

**Non-Goals:**

- Redesign the feature tree, inspector form, top toolbar, or viewport controls.
- Change `ToolActionBus`, editor state machine events, modeling contracts, feature authoring schemas, or kernel adapter behavior.
- Persist debugger collapsed state to operation history, documents, or modeling snapshots.
- Add production telemetry or external debugging dependencies.

## Decisions

Create an extracted presentational debugger component under `src/components/`, supplied with derived display state from `CadWorkbench`. This keeps `CadWorkbench` responsible for state derivation it already owns, keeps the debugger testable, and avoids making sidebar or inspector components aware of unrelated editor state. The alternative of leaving the panel inline in `CadWorkbench` would be the smallest patch, but it would keep the workbench component responsible for a growing block of dense UI.

Represent collapsed/expanded state with local React state near the overlay. This matches the requested collapsible behavior without introducing document persistence or editor events for a purely presentational affordance. The alternative of adding editor-machine state would make collapse state unnecessarily durable and would couple a debug UI preference to CAD behavior.

Remove only duplicated debug readouts from existing layout surfaces. The feature sidebar should keep compact feature tree, object, reference, and document diagnostic navigation. The feature inspector should keep the title, editable form fields, diagnostics rendered by the feature form schema, and commit/cancel controls, but should drop contract/revision text that becomes part of the unified debugger. The alternative of removing broader sections from the sidebar or inspector would risk changing actual authoring workflows rather than only consolidating debug state.

Format filter requirements as debugger rows derived from `selectionFilter.requirements`, including each requirement description and its slot count. This exposes the selection contract directly without changing the underlying selection filter model. The alternative of building a new summarized requirements type would duplicate information already carried by the existing state.

## Risks / Trade-offs

- [Overlay becomes too dense] -> Mitigate with collapsed state, compact row styling, and grouping so the expanded panel remains readable without displacing the CAD canvas.
- [Moving readouts hides useful state from sidebar-only workflows] -> Mitigate by keeping the debugger anchored in the viewport at all times and removing only duplicate status text, not navigation or editing controls.
- [Selection filter requirement formatting is noisy for complex filters] -> Mitigate by showing concise labels/descriptions and slot counts rather than serializing raw filter objects.
- [Pointer event handling could interfere with viewport selection] -> Mitigate by making the overlay container explicitly interactive only for its controls and keeping the rest of the viewport unaffected.

## Migration Plan

1. Add the unified debugger component and move the existing bottom-left debug rows plus selection filter requirement rows into it.
2. Wire collapsed/expanded UI state locally and ensure the overlay remains anchored in the bottom-left viewport.
3. Remove the feature sidebar's "Editor Session" footer and the feature tree header's active mode/filter readouts.
4. Remove redundant debug-only contract/revision readouts from the feature inspector header while preserving feature form controls and diagnostics.
5. Update tests or e2e assertions that depended on the old text locations to assert the unified debugger content and collapse/expand behavior.
