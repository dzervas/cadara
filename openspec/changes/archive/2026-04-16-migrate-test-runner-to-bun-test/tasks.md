## 1. Bun Harness Setup

- [x] 1.1 Inventory the current non-Playwright test scripts in `package.json` and classify each one as a Bun-managed spec file, a preload/setup need, or a non-harness verification command.
- [x] 1.2 Add the minimal Bun test configuration and shared setup needed for TypeScript path resolution, environment parity, and discovery of supported non-e2e `.spec.ts` / `.spec.tsx` files.

## 2. Migrate Existing Specs

- [x] 2.1 Update non-Playwright spec files that currently rely on top-level execution so they register with `bun:test` using the smallest possible structural change.
- [x] 2.2 Keep existing assertions and helper behavior intact while removing reliance on raw `vite-node` or `tsx` test-entry execution.

## 3. Consolidate Scripts And Verify

- [x] 3.1 Reduce `package.json` test scripts to `test` for Bun-managed non-e2e coverage and `test:e2e` for Playwright, and update any repository-owned callers that referenced the removed aliases.
- [x] 3.2 Run the Bun-managed non-e2e suite through `bun run test` and the Playwright suite through `bun run test:e2e`, then record any pre-existing failures without broadening scope into unrelated test fixes.
