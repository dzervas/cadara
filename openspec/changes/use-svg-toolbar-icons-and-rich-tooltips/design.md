## Context

The workbench toolbar is icon-only and currently resolves tool icons through a `ToolIconId -> LucideIcon` map inside `src/components/layout/workspace-toolbar.tsx`. Tool definitions already provide the semantic data the UI needs, including `name`, `tooltip`, `icon`, and dropdown families, but the presentation layer still depends on generic third-party icons instead of the CAD-oriented SVG assets already shipped in `public/icons`.

Tooltip rendering is similarly presentation-only today. Both [`tool-button.tsx`](/app/src/components/layout/tool-button.tsx) and [`tool-dropdown-button.tsx`](/app/src/components/layout/tool-dropdown-button.tsx) render `tool.tooltip` as plain text inside `TooltipContent`, which loses the distinction between the feature name and its explanatory copy. The requested change touches shared toolbar rendering, dropdown variants, and search-result rows, but it should not alter tool ids, action dispatch order, or domain event contracts.

## Goals / Non-Goals

**Goals:**
- Replace `lucide-react` toolbar icon rendering with local SVG asset rendering sourced from `public/icons`.
- Keep icon selection deterministic by introducing an explicit mapping from toolbar tool ids or icon ids to the best-fit SVG filename.
- Render toolbar tooltips with a consistent hierarchy: bold feature name first, descriptive text second.
- Preserve existing action bus behavior, active-state handling, and mode-aware toolbar visibility.

**Non-Goals:**
- Renaming tool ids, changing tool grouping, or changing the current action bus contract.
- Redefining tool descriptions in domain registries beyond what is needed for the tooltip layout.
- Reworking unrelated sidebar icons or other remaining `lucide-react` usage outside toolbar tool presentation.

## Decisions

Use a dedicated toolbar SVG asset map rather than deriving filenames implicitly from `ToolIconId`. The asset set in `public/icons` is close to the tool vocabulary but not perfectly uniform: some tools have exact matches such as `extrude.svg`, `revolve.svg`, and `thicken.svg`, while others align better with alternative filenames such as `linear-pattern.svg`, `circular-pattern.svg`, `curve-pattern.svg`, `split-part.svg`, `move-face.svg`, `delete-bodies.svg`, or `SectionView-Linked.svg`. An explicit map keeps this mismatch visible and reviewable and avoids brittle filename normalization rules.

Introduce a small shared toolbar icon renderer that outputs an SVG image element for both standard buttons and dropdown rows. Keeping icon rendering behind one component or helper avoids duplicating sizing, accessibility, and missing-asset handling across `WorkspaceToolbar`, `ToolButton`, and `ToolDropdownButton`. A fallback path should exist for any tool whose preferred asset is absent so the toolbar remains renderable during development while the map is being completed.

Keep the semantic split between title and description in the UI layer by treating `tool.name` as the tooltip heading and `tool.tooltip` as the body copy. This avoids a cross-cutting schema rename while still producing the requested hierarchy. A shared tooltip content fragment should be used by both plain tool buttons and dropdown-trigger buttons so the layout stays identical everywhere a toolbar button exposes a tooltip.

Continue using the existing tool definitions as the source of truth for which icon asset to use. The cleanest implementation is to preserve `ToolIconId` in the domain model, then translate that icon id to an SVG filename in presentation code. That keeps the domain stable and limits this change to toolbar presentation concerns.

## Risks / Trade-offs

- [Some toolbar tools do not have obvious one-to-one SVG filenames] -> Mitigate by codifying an explicit filename map and documenting best-fit choices in code review rather than relying on string transformations.
- [Using image-based SVG rendering can drift in size or stroke weight versus the previous icon set] -> Mitigate by centralizing icon sizing classes and testing standard buttons, dropdown items, and search rows together.
- [Tooltip layout changes could unintentionally affect accessibility labels] -> Mitigate by preserving concise `aria-label` text derived from the tool name or equivalent plain-text summary while keeping the richer visual tooltip content separate.
- [Residual `lucide-react` usage elsewhere could be confused with this change] -> Mitigate by scoping the implementation and spec to toolbar tool presentation only.
