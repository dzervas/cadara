# Testing Guide

This repository does not treat all tests as the same kind of asset. Choose the test lane first, then write the smallest test that proves the seam.

## Goals

- Maximize confidence in non-UI behavior through seam-based tests.
- Keep static checks and architecture guards separate from behavioral coverage.
- Keep UI tests focused on UI behavior, not as a fallback for domain coverage.
- Prefer a small number of shared fixtures per seam over many one-off file-local harnesses.

## Commands

- `bun run test` is the everyday loop: every non-Playwright spec except the heavy tier, in about a minute (the `fast` and `isolated` Vitest projects, run as two parallel processes so their Typia warm-ups overlap).
- `bun run test:logic` runs the non-UI behavioral lane (fast tier only).
- `bun run test:logic:coverage` emits the non-UI coverage report from the logic lane only.
- `bun run test:ui` runs UI-local and browser-adjacent Bun specs.
- `bun run test:static` runs repository policy guards under `test/static/`.
- `bun run test:heavy` runs the heavy tier: `*.heavy.spec.ts` and the CLI subprocess specs under `src/cli/`, against a CLI bundle built once per run. Minutes, not seconds; run it when the change calls for it (see Choosing validation lanes).
- `bun run test:heavy:acceptance` is the heavy tier plus the opt-in full-import acceptance rows gated on `CADARA_FULL_IMPORT_ACCEPTANCE=1` (today: the ~18-minute 9841 real-OCC apply row); routine `test:heavy` / `test:all` skip them.
- `bun run test:e2e` runs the fast Playwright browser lane with four workers; real-capture acceptance specs are excluded.
- `PLAYWRIGHT_GPU=1 bun run test:e2e` opts into full Chromium with Vulkan GPU acceleration (falling back to SwiftShader when no usable GPU is available). The default and CI retain Playwright's headless shell with SwiftShader; the warm-up browser uses the same mode as the tests.
- `bun run test:e2e:offline` builds the app with the debug platform on (`vite.offline-test.config.ts`, into `.tmp-offline-dist/`) and runs `e2e/offline/` against `vite preview` of that build, cutting the network after load; it is outside `test:all`.
- `bun run test:e2e:diagnostic` reruns the fast lane serially with retained failure traces and video.
- `bun run test:e2e:real-captures` explicitly runs the complete Onshape/OCC acceptance lane against the tracked fixtures in `test/fixtures/onshape-captures` with one worker.
- `bun run test:e2e:real-captures:diagnostic` runs that acceptance lane with retained failure traces and video.
- `bun run test:e2e:all` runs the fast and real-capture Playwright lanes sequentially.
- `bun run test:kernel-limitations` runs the expected-to-fail kernel-limitation specs (see "Kernel limitations"); it is outside every other command, including `test:all`.
- `bun run test:all:acceptance` runs every validation lane, including real captures and the gated full-import acceptance rows; `bun run test:all` runs lint, build, spec typecheck, `test`, `test:heavy`, and the fast E2E lane.

## Choosing validation lanes

Every change runs `bun run test` and lints its touched files. Slower lanes cost minutes to tens of minutes and compete for the host (see Tiers), so add only the ones the change touches:

| The change touches | Also run |
| --- | --- |
| Types shared across modules, specs excluded from the normal typecheck | `bun run typecheck:specs` |
| Build config, `package.json`, Vite/TS config, service worker, assets | `bun run build` |
| OCC kernel, modeling service, semantic session/schema/ports, importers, CLI, any `*.heavy.spec.ts` | `bun run test:heavy` |
| UI, viewport, overlays, notifications, pointer handling, E2E helpers or hooks, sketch drag/solve (`solver-core*`) | `bun run test:e2e` |
| Several rows above, a dependency upgrade, or a large cross-cutting move | `bun run test:all` |

Docs-only changes need no test run beyond the static guards they could affect (`bun run test:static`). When unsure whether a row applies, run its lane rather than all of `test:all`.

## Tiers

Lanes say what a spec proves; tiers say when it runs. Tiers are Vitest projects in `vite.config.ts`, selected by file name:

- `fast` (`*.spec.ts` by default): the budget is one minute for the whole tier, so a single file should stay under about five seconds. It shares one module registry per worker (`isolate: false`), which is what makes it fast.
- `isolated` (`*.isolated.spec.ts`): specs whose `vi.mock` factories need a fresh module instance. Under a shared registry a mock is silently skipped when an earlier file already evaluated the module (`test/static/vitest-tier-boundary.spec.ts` guards this). Prefer injecting a fake through the seam over mocking a module; only mock when the seam has no port.
- `heavy` (`*.heavy.spec.ts`, plus everything under `src/cli/`): real-OCC pipelines, certification meters, and the CLI subprocess specs. Anything that needs more than roughly twenty seconds alone belongs here; name it so rather than slowing the fast tier. Everyday coverage of the same seams stays in the fast tier through the in-process semantic session (`src/application/semantic/`), which is what the CLI drives.

The CLI specs spawn the bundle that `test/helpers/cli-bundle-global-setup.ts` builds once per run and inject through `cliEntry()`. Spawning `bun src/cli/main.ts` costs about thirty seconds and six gigabytes per process because Bun transforms Typia at startup. `workflow-recipes.spec.ts` pays that cost once for a source-entry/OCC smoke test; complete workflows and error exits run against the bundle and an extracted release archive of that same production build. Pass `TestContext.signal` to the shared subprocess helper so a test deadline stops and reaps its child instead of leaving transformation work running.

Row budgets (15 s fast, 120 s for the source CLI smoke) are wall-clock and assume the host is not oversubscribed: local complete lanes fan out to about one worker per CPU. Measured on the 32-CPU reference host (cadara-t2r/b9r/dso, 2026-10-22): one or two concurrent complete lanes (`bun run test`, or one of them plus `test:heavy`) are green; three produce timeout-only failures across all of them (load above 100). Run at most two complete lanes per host at a time; treat a timeout-only failure under heavier load as a rerun, not a defect.

## Test Lanes

### Logic

Use Vitest (`bun run test`, `*.spec.ts`) for non-UI behavior in:

- `src/contracts/`
- `src/core/`
- `src/application/`
- `src/infrastructure/import/`
- `src/infrastructure/modeling/`
- `src/infrastructure/occ/`
- `src/infrastructure/persistence/`
- `src/infrastructure/workers/`

This lane is the main source of non-UI coverage.

### UI

Use Vitest (`bun run test`, `*.spec.tsx`) for presentational or UI-local behavior in:

- `src/app/`
- `src/components/`
- `src/hooks/`
- `src/lib/`
- `src/infrastructure/section-view/`
- `src/infrastructure/viewport/`

These tests should prove rendering behavior, interaction wiring, and local presentation contracts. They do not replace logic-lane coverage.

### E2E

Use Playwright in `e2e/` for cross-surface behavior that must run through the browser and workbench shell.

Prefer the shared harnesses under `e2e/helpers/` instead of ad hoc page scripting when the harness already covers the needed flow.

Pointer-following behaviour (a dimension preview before its placing click, a dragged label or handle) is asserted along the path, not at the endpoint: a label that jumps on intermediate steps but lands in the right place passes an endpoint check. In the logic lane, walk a dense pointer path through the session seam and assert every step (`src/core/editor/sketch-session/dimension-placement-continuity.spec.ts`: the label never moves faster than the pointer, k = 1; it sits at the pointer or on its placed segment within a stated reach; the preview equals the commit). In E2E, glide with `e2e/helpers/pointer-glide.ts`: it moves the mouse one step at a time, samples the followed element's box once it settles after each step (k = 1 plus 2 px per step), and records every position the element is drawn at in between, so a dragged chip drawn away from the pointer for one frame fails too. Keep paths inside one reference zone: crossing a zone boundary switches the carrier by design.

Real Onshape capture tests are an explicit acceptance sub-lane. The curated fixtures in `test/fixtures/onshape-captures` retain the feature history, evidence, IDs, and exact tessellation coordinates consumed by the importer while omitting unused raw API payloads. Their tracked presence must never activate them in `test:e2e`; use `test:e2e:real-captures`, which runs serially to avoid OCC worker starvation. Keep these tests fully asserted rather than replacing them with mock coverage. Arbitrary local `*.onshape-capture.json` files remain ignored.

### Static

Static checks include architecture guards, source scans, import-boundary rules, and similar policy enforcement.

The dedicated static guard surface lives under `test/static/`.

Examples:

- layer boundary checks
- import restriction checks
- empty-catch guards

These are valuable, but they are not behavioral coverage and should be treated as a separate lane conceptually.

### Kernel limitations

`test/kernel-limitations/<kernel>/*.kernel-limitation.spec.ts` (only `occ/` exists) holds minimal raw-kernel reproductions of geometry our production kernel build cannot handle. Each spec asserts what a correct kernel would do, so it is expected to fail. Its top comment records how the case was found, the cause, the kernel pin and any upstream issues. Controls in the same file that show the boundary are expected to pass.

The top-level `test.exclude` in `vite.config.ts` keeps these specs out of every project, so `test`, `test:fast`, `test:isolated`, `test:heavy`, `test:logic`, `test:ui`, `test:static`, `test:all` and a bare `vitest run` never run them. Only `bun run test:kernel-limitations` (`vitest.kernel-limitations.config.ts`) runs them; `typecheck:specs` still typechecks them through `tsconfig.test.json`'s `test` include.

Production refusal messages may link to these files on GitHub. When a spec starts passing, for example after a kernel upgrade, the limitation is lifted: revisit the production message that links to it, then move the reproduction into a normal lane as a regression or delete it.

## Seam Rules

### Contracts

Test parse, validation, normalization, serialization, and versioned payload behavior.

- Prefer schema entrypoints and exported contract helpers.
- Do not test downstream domain behavior here.

### Core

Test exported behavior, state transitions, reducers, registries, solvers, and operation builders.

- Prefer pure inputs and outputs.
- Assert observable behavior at the module boundary.
- Do not reach into private helpers when the exported API can prove the same thing.

### Application

Test orchestration seams.

- Mock or fake ports and collaborators.
- Assert sequencing, retries, conflict handling, state handoff, and error propagation.
- Avoid asserting internal implementation shape when observable calls and outcomes are enough.

### Infrastructure

Test adapter conformance.

- Prove that an adapter satisfies the contract expected by the consuming layer.
- Prefer shared adapter fixtures or contract-style assertions over incidental implementation checks.

### UI

Test render-local behavior, visual state contracts, and event wiring.

- Keep business rules in lower-layer tests whenever possible.
- Avoid using UI tests to cover logic that should live in `contracts`, `core`, `application`, or `infrastructure`.

## What Not To Do

- Do not add a non-UI test in a UI folder because the code is nearby.
- Do not add static policy checks to inflate non-UI coverage.
- Do not test private helpers if a public seam exists.
- Product examples and artwork can provide useful complex-input smoke coverage, but must not supply accidental premises such as "the first dimension is 20". Construct a fixture for the behavior being asserted; retain a real model only when it carries a specific regression.
- Compare solved geometry at the model's stated accuracy, not by hashing raw floating-point output across JavaScript runtimes. Exact equality is appropriate for byte-level contracts or same-runtime comparisons that specifically prove an optimization preserves its reference behavior.
- Do not create a new one-off harness when a seam-specific shared fixture would make future tests cheaper.
- Do not default to end-to-end coverage for behavior that can be proven in the logic lane. Authored/model semantics (geometry, requirements, features, history, persistence, exports) go through the in-process semantic session (`src/application/semantic/`, fixtures in `test/helpers/semantic-*.ts`); an E2E row must prove something only the browser has (pointer inference, picking, overlays, workers, peers, downloads). When a flow lacks a semantic seam, expose the seam (epic `cadara-d17` lists the known gaps) rather than reaching for Playwright.

## Placement Rules

- Co-locate logic tests with the modules they protect unless the test is a cross-cutting static check.
- Put cross-cutting static checks in `test/static/` and keep them named as guards, boundaries, or architecture checks.
- Keep shared test builders small and seam-specific.
- If multiple tests need the same setup, extract a builder or fake for that seam instead of copying setup blocks.

## Coverage Policy

When improving coverage for non-UI code:

1. Measure only the intended non-UI scope.
2. Prioritize high-risk seams first: orchestration, state machines, persistence boundaries, schema/version boundaries, adapters.
3. Add tests at exported seams.
4. If a module is hard to test at a seam, treat that as a design problem and refactor the module boundary.

Static checks and UI tests should not be used to compensate for missing logic-lane coverage.

The first post-refactor logic-lane baseline is 83.09% line coverage and 83.89% function coverage. The repository currently reports that baseline informationally first rather than enforcing a hard threshold.

## Conventions

- Prefer explicit builders like `make...`, `create...`, `fake...`, and `stub...` for reusable setup.
- Keep helper APIs narrow and named after the seam they support.
- Prefer complete assertion messages that describe the contract being protected.
- When a test is really an architecture or policy guard, say so in the file name and test name.

## Decision Checklist

Before writing a test, answer:

1. Which lane is this: logic, UI, e2e, or static?
2. What seam am I proving?
3. Can I test it through an exported boundary?
4. Should this setup become a shared seam fixture?
5. Am I accidentally testing policy, UI, and business logic in one file?
