## Why

The repository currently runs non-Playwright tests through a growing set of script-specific raw TypeScript entrypoints, which makes the test surface harder to discover, harder to run consistently, and easy to drift as more specs are added. Moving those tests onto `bun:test` now gives the project a single native harness for local and CI execution without changing the Playwright workflow or the intent of the existing tests.

## What Changes

- Replace raw TypeScript test-entry scripts that invoke individual spec files through `vite-node` or `tsx` with a shared `bun:test`-driven unit and integration test harness.
- Consolidate package scripts so the supported test entrypoints are `test` for Bun-managed non-e2e coverage and `test:e2e` for Playwright coverage.
- Preserve the current test files and assertions as-is unless a minimal harness adaptation is required to register them with `bun:test`.
- Keep Playwright configuration and browser-based e2e execution unchanged.

## Capabilities

### New Capabilities
- `bun-test-harness`: Defines the supported developer workflow for running repository unit and integration specs through Bun's native test harness while keeping Playwright as the separate e2e harness.

### Modified Capabilities
- None.

## Impact

- Affected code: `package.json`, test entry/config files, and the existing `.spec.ts` / `.spec.tsx` files that currently rely on top-level execution instead of a test harness.
- Affected tooling: Bun test execution, any test-only setup required for DOM or module resolution parity, and CI or local commands that currently call the removed script-specific test targets.
- Unchanged systems: Playwright config, Playwright tests under `e2e/`, and the user-facing application runtime.
