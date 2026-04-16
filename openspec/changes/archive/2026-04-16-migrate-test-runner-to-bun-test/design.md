## Context

The repository currently mixes two test execution models:

- Playwright e2e coverage already runs through `playwright test` and should remain unchanged.
- Unit and integration coverage is fragmented across many `package.json` scripts that execute individual `.spec.ts` and `.spec.tsx` files through `vite-node` or `tsx`.

That fragmentation creates a maintenance problem rather than a product problem. Adding or renaming specs currently requires updating ad hoc scripts, and there is no single supported non-e2e entrypoint. The codebase already standardizes on Bun for package management and script execution, so Bun's built-in test harness is the smallest native replacement for the raw TypeScript execution pattern.

Constraints for this change:

- Do not change Playwright behavior.
- Do not treat this migration as permission to rewrite, fix, or re-scope existing tests.
- Keep the script surface intentionally small so `test` and `test:e2e` are the only supported public test commands.

## Goals / Non-Goals

**Goals:**

- Run repository non-e2e specs through `bun:test` instead of direct `vite-node` or `tsx` execution.
- Preserve current test intent, assertions, and file ownership while adapting only the minimum needed for Bun harness registration.
- Replace the many script-specific test commands with a single `test` command, while keeping `test:e2e` for Playwright.
- Keep TypeScript path resolution, DOM availability, and any required preload/setup behavior compatible with the existing specs.

**Non-Goals:**

- Changing application behavior or test assertions.
- Merging Playwright into Bun's harness or changing the Playwright config.
- Expanding test coverage, fixing flaky tests, or cleaning up unrelated legacy test code.
- Introducing a second general-purpose test runner such as Vitest or Jest.

## Decisions

### Use `bun:test` as the single non-e2e harness

The repository already depends on Bun, so `bun:test` is the narrowest tooling change that removes raw TypeScript execution without adding a new runner stack. This keeps dependency churn low and aligns the test workflow with the project's runtime/package-manager choice.

Alternative considered:

- Continue using `vite-node` or `tsx` behind a single aggregate script. Rejected because it preserves the same top-level execution model and does not give the repository a real test harness with native discovery, filtering, and consistent reporting.
- Introduce Vitest. Rejected because the request is specifically to migrate to `bun:test`, and adding Vitest would increase configuration and dependency surface beyond the requested scope.

### Preserve test files whenever Bun can discover them with minimal adaptation

Existing spec files should stay in place and keep their current assertions. Where a file already follows harness-style structure, the implementation can switch imports to `bun:test` directly. Where a file currently executes through top-level function calls, the implementation should wrap the existing assertions in Bun test cases with the smallest possible structural change.

Alternative considered:

- Rewrite all tests into a new shared utility style. Rejected because it violates the requirement not to break or opportunistically fix the current tests.

### Keep browser-smoke and e2e execution outside the Bun unit harness when they are materially different workflows

The current script set includes both non-e2e spec execution and at least one browser-build smoke step. The migration should classify these workflows deliberately instead of forcing every script into Bun discovery. Pure `.spec.*` files belong in Bun's harness; Playwright remains under `test:e2e`; non-spec build-smoke verification, if it must remain, should be owned by implementation decisions without reintroducing extra public test scripts.

Alternative considered:

- Encode every current test-like script as a Bun test case regardless of shape. Rejected because build-smoke steps may be better represented as internal setup or separate verification work than as harness-managed test files.

### Expose only `test` and `test:e2e` as supported scripts

The package script contract should become intentionally simple:

- `test`: runs Bun-managed non-e2e tests
- `test:e2e`: runs Playwright

This matches the requested outcome and removes the maintenance burden of script-per-suite naming.

## Risks / Trade-offs

- [Some existing specs rely on top-level execution rather than registered test cases] → Mitigate by converting only the test registration wrapper, leaving the assertions and helper functions intact.
- [Some specs may depend on Vite-specific module resolution or DOM shims that Bun does not provide by default] → Mitigate by adding a minimal shared Bun preload/setup layer rather than per-file workaround scripts.
- [Removing script-specific entrypoints could break local or CI callers that still reference them] → Mitigate by updating the documented workflow and any repository-owned automation in the same change.
- [Non-spec build-smoke commands may not map cleanly onto `bun:test`] → Mitigate by deciding explicitly whether they belong inside `test`, as internal verification steps, or outside the public script contract before implementation begins.

## Migration Plan

1. Inventory the current non-Playwright test scripts and classify them as harness-managed spec files versus non-harness verification commands.
2. Introduce the Bun harness configuration and any shared preload/setup needed for path aliases, DOM, or environment parity.
3. Adapt existing `.spec.ts` and `.spec.tsx` files only where required so Bun can discover and run them without changing their behavioral assertions.
4. Collapse package scripts to `test` and `test:e2e`, and update repository-owned callers accordingly.
5. Verify that Bun-managed tests and Playwright still execute through their respective top-level commands.

Rollback is straightforward: restore the prior package scripts and test entry execution strategy if Bun harness compatibility proves incomplete.

## Open Questions

- Which current non-spec verification commands, if any, must remain part of the repository's standard verification path after the public script surface is reduced?
