## Context

The toolbar currently renders the desired local SVG assets through `ToolIconId`, `toolbarToolIconAssetMap`, `getToolbarToolIconSrc`, and `ToolbarToolIcon`. Other tool-aware surfaces still select icons through `WorkbenchIcon` names or local switches: feature history uses generic history/sketch/layers icons, sketch history maps entities/constraints/dimensions locally, and Parts & Objects maps bodies/sketches/components locally. That creates multiple icon-definition points for modeling concepts that should share the toolbar's visual language.

The existing separation between domain tool metadata and presentational components should remain intact. Tool definitions already own stable tool IDs and icon IDs, and feature authoring definitions expose feature metadata for toolbar registration. The change should reuse those existing contracts instead of introducing a new icon library or replacing generic shell icons.

## Goals / Non-Goals

**Goals:**
- Make one shared tool icon registry the only place that maps `ToolIconId` values to local SVG asset files.
- Preserve the toolbar's current icon choices exactly while moving the mapping out of toolbar-only ownership.
- Provide a small shared renderer or resolver that toolbar, feature history, sketch history, and Parts & Objects can consume for tool/modeling concept icons.
- Keep generic workbench action icons, such as rename, delete, visibility, file, and context-menu actions, in the existing `WorkbenchIcon` path.
- Add tests that cover registry use and prevent reintroducing parallel tool icon asset maps.

**Non-Goals:**
- Replacing every `WorkbenchIcon` usage.
- Redesigning icon sizing, colors, or toolbar button behavior.
- Adding new icon assets or changing the toolbar's current asset filenames.
- Changing tool activation, feature authoring, selection, or history behavior.

## Decisions

1. Move the toolbar asset map into a domain-adjacent tool icon module and re-export only through shared helpers.

   Rationale: the toolbar's current map is already keyed by `ToolIconId`, which is the right stable contract for tool-related icons. Moving the map to `src/domain/tools/` or another non-toolbar-specific module prevents sidebar and history components from importing toolbar presentation internals.

   Alternative considered: keep the map in `components/layout` and import it everywhere. That is smaller but keeps toolbar as the apparent owner of non-toolbar icon choices, which is the duplication this change is meant to remove.

2. Keep `WorkbenchIcon` for generic shell and action icons.

   Rationale: a single point of definition is required for tool/modeling icons, not for all UI chrome. Merging file, visibility, menu, and status glyphs into `ToolIconId` would inflate the tool contract with non-tool concepts.

   Alternative considered: replace all workbench icons with one global icon registry. That would be broader than the request and risks unrelated visual churn.

3. Resolve feature history icons through feature/tool metadata where available, with explicit fallbacks only for non-tool concepts.

   Rationale: committed feature items should display the same icon used to author that feature when the feature kind has a registered authoring definition. Sketch timeline items can reuse sketch, constraint, and dimension tool icon IDs. Parts & Objects entries that represent sketches or feature-backed objects should use the shared tool icons; body/component object icons can remain generic unless a corresponding tool icon definition exists.

   Alternative considered: add an icon field directly to every presentation record. That would push icon selection into document projection data and duplicate the tool metadata already present in feature and sketch registries.

4. Use focused structural tests rather than broad screenshot tests.

   Rationale: this change is about icon source ownership and rendered asset paths. Existing render-to-static-markup tests can assert the expected `/icons/*.svg` paths and module-level tests can assert a single exported asset map. Screenshots would add cost without improving confidence for this scope.

## Risks / Trade-offs

- Risk: Moving the map can break single-file asset bundling that uses `__CADARA_SINGLE_ASSETS__`. -> Mitigation: keep `getToolIconSrc` behavior equivalent to the current `getToolbarToolIconSrc`, including the global asset lookup.
- Risk: Some sidebar objects do not have a matching tool icon. -> Mitigation: only use shared tool icons for concepts with an existing `ToolIconId`; leave generic body/component and action icons on `WorkbenchIcon`.
- Risk: Importing feature registries into timeline UI can increase coupling. -> Mitigation: add small resolver helpers in domain or layout helper modules that accept item records and return `ToolIconId | null`, keeping React components simple.
- Risk: Tests could overfit to file organization. -> Mitigation: assert public behavior and absence of duplicate tool asset maps, not every internal import path.
