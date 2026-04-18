## Context

The workbench already has multiple partial error paths. Editor effects are converted into typed events in `runEditorEffect`, modeling operations often return diagnostics, and the workbench has local action handlers that catch rejected promises and set status strings. These paths are inconsistent: context is lost, some failures are UI-only, some are console-only, and future external tracking would have to be added in many places.

The current stack is React, TypeScript, XState, zod, Mantine, Bun, and Playwright. The change should preserve the existing editor/runtime split, avoid moving scene or modeling logic into UI components, and add a small dependency for Rust-style result handling without replacing XState orchestration.

## Goals / Non-Goals

**Goals:**

- Establish one canonical `AppError` shape for user-visible and developer-visible failures.
- Use `neverthrow` for typed `Result` / `ResultAsync` composition at async and validation boundaries.
- Convert thrown `unknown`, rejected promises, zod failures, modeling diagnostics, and unexpected runtime failures into `AppError`.
- Provide one reporter abstraction that can write to console now and later forward to Sentry-like tracking.
- Route user-action failures to existing workbench UI surfaces without local ad hoc catch blocks.
- Enforce that catch blocks are never empty and that caught errors are reported, transformed, or rethrown.
- Add focused unit and E2E coverage for the pipeline and representative erroneous actions.

**Non-Goals:**

- Rewriting every pure helper to return `Result` in the first implementation slice.
- Replacing existing modeling diagnostics with `AppError`; diagnostics remain the modeling-domain user-facing format.
- Introducing a Sentry SDK or vendor-specific tracker in this change.
- Treating expected validation failures as fatal render crashes.
- Replacing XState runtime orchestration with a new effect system.

## Decisions

### Use neverthrow at Boundaries

Use `neverthrow` for functions that cross trust or async boundaries: zod parsing, storage/repository access, modeling service calls, OpenCascade adapter calls, editor effect runtime calls, downloads, and workbench actions. Internal pure helpers can keep returning plain values or domain unions unless they already have meaningful failure branches.

Alternatives considered:

- A local `Result` implementation would avoid a dependency but would likely grow `mapErr`, async composition, and `combine` helpers over time.
- Effect would provide a richer typed effect system, but it overlaps with existing XState orchestration and has a larger programming model than this change needs.

### Canonical Error Shape

Introduce a small error contract, likely under `src/contracts/errors/`, with an `AppError` object carrying:

- stable `code`
- `severity`
- human `message`
- structured `context` entries
- optional `cause`
- optional `target`
- optional `requestId` or correlation data
- optional `recoverable` or `category` metadata if needed by UI presentation

Errors gain context only at meaningful boundaries. Deep code should not know about UI placement or external tracking.

### Reporter Sink Abstraction

Create an `ErrorReporter` interface with a default implementation that logs actionable failures to the console and stores recent UI-visible reports for the workbench. Keep the reporter transport-based so a future Sentry-like sink can be added as a second transport.

The reporter interface should accept `AppError` plus lightweight reporter metadata such as source, visibility, and deduplication key. It must not import Sentry or any vendor SDK in this change.

### UI Reporting Surfaces

Use the existing workbench notification/status surface for action-level failures. Modeling and feature-preview failures should continue to appear as diagnostics when a target or edit session is available, with `AppError` converted into a `ModelingDiagnostic` when needed.

Render-time fatal crashes should be caught by a React error boundary and reported through the same reporter. Async/event-handler errors must be captured by action/effect helpers because React error boundaries do not catch ordinary async callbacks or event handlers.

### Editor Runtime Safety Net

Keep `runEditorEffect` returning typed failure events for expected failures, but normalize all caught `unknown` through the shared error helpers. Add an XState `invoke.onError` safety net in the runtime machine for any unexpected rejection that escapes the effect event conversion.

### Workbench Action Wrapper

Introduce a helper for user-triggered workbench operations, for example `runWorkbenchAction`, that:

- wraps a `Promise` or `ResultAsync`
- maps rejected and diagnostic failures to `AppError`
- reports the error through `ErrorReporter`
- updates the appropriate UI status state
- returns a typed success/failure result to the caller

This replaces repeated local `.catch((error) => setWorkbenchStatusMessage(...))` patterns for variable updates, renames, deletes, history cursor changes, export failures, and similar actions.

### Static Enforcement

Use ESLint to prohibit empty catches. If the built-in no-empty rule is not enough for the desired behavior, add a small local test or lint rule that scans TypeScript/TSX source for empty catch blocks and catch blocks that neither rethrow nor call the approved reporting/normalization helpers.

The first enforcement target is strict no-empty-catch. Broader "must report or rethrow" enforcement can start with tests around common patterns and be tightened after the pipeline helpers exist.

### E2E Coverage

Add Playwright tests that trigger representative erroneous actions and assert at least one reporting path:

- UI notification/status appears with a human-readable message.
- Console receives an actionable error record.
- Feature or document diagnostics appear for modeling failures when applicable.

Prefer stable user-level flows over synthetic internals, but allow test-only hooks only if the app has no reliable UI path to trigger an expected error.

## Risks / Trade-offs

- Result types could spread too deeply into leaf code and make simple helpers noisy -> limit neverthrow to explicit boundaries and document where plain throws remain acceptable for programmer invariants.
- Duplicate reporting could occur when one failure passes through several boundaries -> include dedupe keys or mark errors as already reported in reporter metadata.
- The UI could over-report expected validation mistakes as scary failures -> classify expected validation/domain rejections separately from unexpected exceptions.
- Console logging could expose noisy stack traces during normal validation flows -> log concise records for expected errors and full cause/stack only for unexpected exceptions or development mode.
- Empty-catch enforcement may flag legitimate cleanup code -> require a comment plus explicit `reportIgnoredError` or `throw` so intentional suppression is visible and searchable.
- Future Sentry integration may need richer context than the first `AppError` shape -> keep context entries structured and transport-agnostic rather than string-only.

## Migration Plan

1. Add `neverthrow` and the shared error contract/helpers with unit tests.
2. Add the reporter abstraction with console transport and a test reporter.
3. Convert editor effect failure normalization and add runtime `invoke.onError` safety handling.
4. Convert high-value workbench actions to the action wrapper.
5. Convert zod/runtime contract parse helpers used at boundaries to return or adapt `Result` failures.
6. Add lint/static tests for empty catch blocks.
7. Add Playwright erroneous-action coverage.
8. Keep existing thrown invariant errors unless they cross a boundary; normalize them at the nearest effect/action/reporter boundary.

Rollback is straightforward because this change adds adapters around existing boundaries. If the pipeline causes regressions, individual action wrappers can be reverted to direct service calls while keeping the shared error contract in place.

## Open Questions

- Which UI component should own the durable list of recent error reports once Sentry-like tracking exists: workbench-local state or a provider-level error store?
- Should production console output include all reported expected errors, or only unexpected exceptions and explicitly user-visible failures?
- Which reporter metadata should be considered sensitive before external tracking is added?
