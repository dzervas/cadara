## 1. Centralize Mantine color ownership

- [x] 1.1 Expand `src/theme/workbench-theme.ts` so Mantine theme tokens cover shell surfaces, tooltip contrast, semantic success styling, and any shared color aliases still needed by custom overlay containers.
- [x] 1.2 Replace non-theme color definitions in `src/index.css` and other shared styling entry points with Mantine-backed variables or remove them where Mantine component styling can own the surface directly.

## 2. Remove component-level color drift

- [x] 2.1 Update toolbar, search, tooltip, dropdown, and shared scroll-area presentation so active, hover, and tooltip states derive from Mantine theme colors, with `Finish Sketch` rendered as the semantic success action during sketch mode.
- [x] 2.2 Sweep the remaining workbench shell and viewport-adjacent overlay components to remove raw app-authored presentation color literals in favor of Mantine theme tokens only.

## 3. Lock in the rule with tests

- [x] 3.1 Add or update tests for toolbar tooltip contrast, `Finish Sketch` success styling, and a regression guard that rejects raw presentation color literals outside the centralized theme definition and approved static asset files.
- [x] 3.2 Run `bun run test` and `bun run lint`, then resolve any failures caused by the Mantine theme migration.
