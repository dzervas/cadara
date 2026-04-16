## 1. Theme Foundation

- [x] 1.1 Add Mantine dependencies and provider wiring for the React app entrypoint.
- [x] 1.2 Create a central workbench theme module that exports the dark-first Mantine colors tuple and shared theme configuration.
- [x] 1.3 Remove or reduce legacy global CSS variables that become redundant once Mantine theme tokens exist.

## 2. Shared UI Migration

- [x] 2.1 Replace shared shell primitives in `src/components/ui/` with Mantine-based implementations or direct Mantine usage.
- [x] 2.2 Migrate toolbar, dropdown, tooltip, input, scroll, and panel surfaces to Mantine components while preserving existing tool behavior.
- [x] 2.3 Delete superseded wrapper code and styling helpers created only for the old shell component stack.

## 3. Workbench Simplification

- [x] 3.1 Update sidebar, inspector, and related workbench shell surfaces to consume the centralized Mantine theme and minimize local style overrides.
- [x] 3.2 Keep viewport-specific overlays custom only where Mantine would add code or reduce interaction control.
- [x] 3.3 Add or update tests to cover migrated shell behavior without depending on removed visual flourishes.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
- [x] 4.3 Confirm the remaining custom CSS is limited to reset, root layout, and viewport-specific surfaces.
