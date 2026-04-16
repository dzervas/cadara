## Context

The current workbench shell is visually coherent, but much of that coherence is maintained through repeated utility-class strings and custom CSS variables instead of through a single themed component system. Toolbar buttons, menus, inputs, panels, and scroll containers are all manually styled even though they mostly express standard UI patterns. The requested direction is to reduce line count first, accept some loss of decorative polish, and keep the dark, dense, CAD-like soul of the interface.

The main constraint is that the viewport and editor behavior contracts must remain intact. Tool registration, mode switching, viewport controls, and scene logic should not become coupled to the UI library migration.

## Goals / Non-Goals

**Goals:**

- Make Mantine the default component library for workbench chrome and authoring controls.
- Centralize the Mantine color tuple and dark theme configuration in one easily editable module.
- Remove most custom shell CSS and shrink per-component styling code.
- Preserve existing workbench behavior, density, and dark-mode tone during the migration.

**Non-Goals:**

- Reworking domain contracts, tool ids, or viewport interaction semantics.
- Preserving every current decorative treatment, shadow, gradient, or hover flourish.
- Replacing viewport-specific rendering overlays with Mantine when the result would add complexity.

## Decisions

### Use Mantine as the primary shell component surface

The migration should replace current shell primitives with Mantine components instead of layering Mantine on top of the existing shadcn-style wrappers. `ActionIcon`, `Menu`, `Tooltip`, `TextInput`, `ScrollArea`, `Paper`, `Stack`, `Group`, and related Mantine primitives cover most of the repeated UI patterns in the workbench.

This is preferable to a mixed wrapper approach because the goal is lower code volume, not another abstraction layer.

### Centralize the dark palette in one theme module

The implementation should define a single theme module such as `src/theme/workbench-theme.ts` that exports:

- a dark-first Mantine `colors` tuple used as the source of truth for the workbench palette
- the Mantine theme object built from that tuple
- any small shared sizing or radius tokens needed by multiple shell components

All standard shell components should consume Mantine theme values from that module instead of declaring local CSS variables or repeated color literals.

This is preferable to keeping theme data in `index.css` because palette changes then happen in one TypeScript module instead of across CSS and JSX.

### Keep Tailwind and custom CSS only for layout glue and viewport-specific surfaces

Tailwind should remain available for coarse layout composition and one-off spacing where it is clearly smaller than extra Mantine wrappers. Custom CSS should be limited to reset/root behavior and viewport-owned surfaces such as the full-page background, canvas container behavior, and Three.js-specific overlays when Mantine would not reduce code.

This is preferable to a full Tailwind removal because the layout already uses it effectively in a few structural places. It is also preferable to retaining the current shell styling approach because the repeated class stacks are exactly what the migration is trying to reduce.

### Favor simpler Mantine defaults over visual parity work

When a choice exists between reproducing custom gradients, layered shadows, and bespoke hover states or using a Mantine default that preserves the same behavior with much less code, the migration should choose the Mantine default.

This is preferable to pixel-matching the current UI because the stated success metric is fewer lines of styling code while preserving the interface's dark, compact character.

## Risks / Trade-offs

- [Mantine defaults can make the workbench feel less custom] → Mitigate by tuning the shared dark palette, density, radius, and typography in the central theme before adding local overrides.
- [A partial migration can leave two UI systems in active use for too long] → Mitigate by migrating shared shell primitives first and deleting obsolete wrappers as each surface is converted.
- [Some viewport-adjacent overlays may fit Mantine poorly] → Mitigate by explicitly allowing viewport-specific UI to remain custom when Mantine would increase code or reduce control.
- [Theme overrides can slowly reintroduce styling sprawl] → Mitigate by requiring shell color changes to start from the central color tuple and keeping component-level overrides rare.

## Migration Plan

1. Add Mantine dependencies and wrap the app in a `MantineProvider` configured from the new central dark theme module.
2. Migrate shared shell primitives and the highest-reuse layout controls first: inputs, tool buttons, menus, tooltips, scroll containers, and panel surfaces.
3. Convert workbench layout surfaces to consume Mantine components and theme tokens, then remove superseded custom CSS and wrapper code.
4. Leave viewport-specific rendering surfaces custom where Mantine does not reduce code, and verify that editor behavior remains unchanged.

## Open Questions

- Whether any remaining Radix dependency is still justified after dropdown, tooltip, and scroll-area migration.
- Whether the workbench should expose a light theme later or keep the initial Mantine setup dark-only until a real product requirement appears.
