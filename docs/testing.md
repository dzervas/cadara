# Testing Guide

This repository does not treat all tests as the same kind of asset. Choose the test lane first, then write the smallest test that proves the seam.

## Goals

- Maximize confidence in non-UI behavior through seam-based tests.
- Keep static checks and architecture guards separate from behavioral coverage.
- Keep UI tests focused on UI behavior, not as a fallback for domain coverage.
- Prefer a small number of shared fixtures per seam over many one-off file-local harnesses.

## Commands

- `bun run test:logic` runs the non-UI behavioral lane.
- `bun run test:logic:coverage` emits the non-UI coverage report from the logic lane only.
- `bun run test:ui` runs UI-local and browser-adjacent Bun specs.
- `bun run test:static` runs repository policy guards under `test/static/`.
- `bun run test` runs the umbrella non-Playwright suite: logic, UI, and static.
- `bun run test:e2e` runs the Playwright browser lane.

## Test Lanes

### Logic

Use `bun:test` for non-UI behavior in:

- `src/contracts/`
- `src/core/`
- `src/domain/`
- `src/application/`
- `src/infrastructure/modeling/`
- `src/infrastructure/persistence/`
- `src/infrastructure/workers/`

This lane is the main source of non-UI coverage.

### UI

Use `bun:test` for presentational or UI-local behavior in:

- `src/app/`
- `src/components/`
- `src/hooks/`
- `src/lib/`
- `src/infrastructure/occ/`
- `src/infrastructure/section-view/`
- `src/infrastructure/viewport/`

These tests should prove rendering behavior, interaction wiring, and local presentation contracts. They do not replace logic-lane coverage.

### E2E

Use Playwright in `e2e/` for cross-surface behavior that must run through the browser and workbench shell.

Prefer the shared harnesses under `e2e/helpers/` instead of ad hoc page scripting when the harness already covers the needed flow.

### Static

Static checks include architecture guards, source scans, import-boundary rules, and similar policy enforcement.

The dedicated static guard surface lives under `test/static/`.

Examples:

- layer boundary checks
- import restriction checks
- empty-catch guards

These are valuable, but they are not behavioral coverage and should be treated as a separate lane conceptually.

## Seam Rules

### Contracts

Test parse, validation, normalization, serialization, and versioned payload behavior.

- Prefer schema entrypoints and exported contract helpers.
- Do not test downstream domain behavior here.

### Core and Domain

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
- Avoid using UI tests to cover logic that should live in `contracts`, `core`, `domain`, `application`, or `infrastructure`.

## What Not To Do

- Do not add a non-UI test in a UI folder because the code is nearby.
- Do not add static policy checks to inflate non-UI coverage.
- Do not test private helpers if a public seam exists.
- Do not create a new one-off harness when a seam-specific shared fixture would make future tests cheaper.
- Do not default to end-to-end coverage for behavior that can be proven in the logic lane.

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
