## Context

The workbench already exposes a shared Mantine theme in [`src/theme/workbench-theme.ts`](/app/src/theme/workbench-theme.ts), but the current UI still mixes that theme with many raw color literals in `src/index.css`, shell components, viewport-adjacent overlays, and small utility wrappers such as the shared scroll area. The result is visible drift: blue-tinted active states that do not follow the current Mantine palette, tooltip text that assumes a dark tooltip surface without guaranteeing one, and a `Finish Sketch` action that looks like every other neutral toolbar tool.

This change is cross-cutting because the user requirement is absolute: Mantine colors must be the only source of truth for app-authored presentation colors. That turns the work from a toolbar polish pass into a theme-governance change that needs one implementation strategy for shell panels, form-like controls, tooltip surfaces, and custom viewport-owned overlays.

## Goals / Non-Goals

**Goals:**
- Centralize every app-authored presentation color in the Mantine theme so component code no longer embeds raw hex, `rgb(...)`, `rgba(...)`, or similar color literals.
- Replace workbench shell and overlay color usage with Mantine component styling or theme-backed CSS variables that resolve from `--mantine-color-*` tokens only.
- Make toolbar tooltip surface and text colors derive from the same Mantine configuration so contrast remains correct in the dark shell.
- Give `Finish Sketch` a semantic success-green treatment without changing tool ids, mode rules, layout, or action bus behavior.
- Add an automated regression guard so new raw presentation color literals are rejected after this cleanup lands.

**Non-Goals:**
- Renaming tool ids, changing tool-group visibility rules, or altering the current toolbar action dispatch contract.
- Redesigning component layout, spacing, copy, or interaction behavior beyond the color-source cleanup and the semantic `Finish Sketch` emphasis.
- Introducing a second styling system or bespoke theme wrapper outside Mantine.

## Decisions

Mantine theme colors become the sole palette owner for app-authored UI colors. The shared theme module will remain the one place allowed to define color tuples or semantic color selection, and any surviving CSS custom properties in `src/index.css` or component code must become aliases that point to Mantine CSS variables rather than alternate color definitions. This keeps the source of truth singular while still allowing custom surfaces to consume theme-backed variables where Mantine primitives are not a direct fit.

Translucent surfaces and emphasis states will be expressed as derivatives of Mantine colors instead of preserving current handwritten RGBA values. Where a surface needs opacity or tint, implementation should compute it from Mantine tokens through Mantine-supported style helpers or CSS that references Mantine variables, rather than entering a new literal. The alternative, preserving the existing literal gradients and tinted overlays, was rejected because it would keep a parallel unmanaged palette in the codebase.

Standard shell controls should move closer to Mantine-owned styling, while viewport-owned overlays may remain custom containers as long as their colors are theme-backed. Toolbar buttons, dropdown menus, tooltips, search inputs, inspector controls, sidebar rows, timeline affordances, and shared scroll areas should prefer Mantine props or component `styles` overrides. Overlays that remain custom `div` structures because of viewport positioning or interaction constraints should still consume Mantine-derived surface, border, text, and semantic colors through shared variables or helpers. The alternative of doing a narrow toolbar-only cleanup was rejected because the user requirement explicitly forbids custom color sources anywhere in the app-authored presentation layer.

`Finish Sketch` should gain a presentation-level semantic intent rather than another hardcoded special-case color. The toolbar rendering path should resolve appearance by tool role, so neutral tools continue to use the workbench palette while the visible sketch-exit action adopts Mantine's success green. Keeping this intent in presentation code preserves the current tool registry contract and avoids spreading styling conditionals across unrelated components.

Add a regression test that scans app source for raw presentation color literals outside explicitly allowed files. A small `bun:test` check can inspect `src/` and fail if it finds hex or `rgb`/`rgba`/`hsl` literals in application code, while allowing the centralized theme definition and static asset directories where embedded SVG paint data may still exist. Manual review alone was rejected because the requirement is strict and easy to regress during routine UI work.

## Risks / Trade-offs

- [A strict literal-color guard may flag legitimate static assets or test fixtures] -> Mitigate with a narrow allowlist for theme-definition files and asset directories, and keep the guard scoped to app-authored presentation code.
- [Some current translucent or gradient surfaces may be harder to reproduce exactly from Mantine tokens] -> Mitigate by preferring simpler Mantine-driven surfaces when necessary; the project already prioritizes behavioral parity over decorative parity.
- [The cleanup touches many presentation files at once] -> Mitigate by keeping the change surgical to color sourcing only, preserving layout and behavior, and relying on focused presentation tests plus the new regression guard.

## Migration Plan

1. Expand the centralized Mantine theme and component overrides so shell surfaces, tooltip styling, semantic success state, and shared color aliases are available from one place.
2. Replace raw color literals and non-theme color variables across shell components, viewport overlays, and shared UI helpers with Mantine-backed tokens.
3. Add the literal-color regression test and update presentation tests that assert toolbar and tooltip behavior.

## Open Questions

None.
