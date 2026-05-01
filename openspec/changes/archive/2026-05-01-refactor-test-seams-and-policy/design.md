## Context

The repository currently has a large Bun-managed `src/**/*.spec.ts(x)` surface and a smaller but more structured Playwright `e2e/` surface. The Bun side mixes several different concerns in one execution lane:

- non-UI behavioral tests for `contracts`, `core`, `domain`, `application`, and `infrastructure`
- UI-local rendering and presentation tests for `app`, `components`, and `hooks`
- architecture and import-boundary guards
- source-scan policy checks such as empty-catch detection

This mixing makes it hard to answer basic questions:

- which test type is expected for a new module?
- what counts toward non-UI confidence?
- where should static policy checks live?
- which helpers are reusable seam fixtures versus one-off local setup?

The repository already has signals that the architecture wants a cleaner split:

- distinct layer roots under `src/`
- existing architecture-boundary specs
- a structured Playwright harness under `e2e/helpers/`
- a new `docs/testing.md` and `AGENTS.md` guidance entry that describe seam-based testing

The change needs to turn those signals into an executable test architecture without forcing a flag day rewrite.

## Goals / Non-Goals

**Goals:**
- Establish four durable test lanes: `logic`, `ui`, `e2e`, and `static`
- Make non-UI coverage measurable independently from UI tests and static guards
- Define seam ownership by layer so contributors can choose the right test target consistently
- Reclassify the current suite incrementally while keeping tests green
- Consolidate cross-cutting seam fixtures where they are genuinely reusable
- Preserve Playwright as the browser e2e harness and Bun as the non-Playwright harness

**Non-Goals:**
- Rewriting every existing spec into a new style in one pass
- Replacing Bun or Playwright
- Eliminating all file-local helpers; only cross-cutting or repeated seam setup needs consolidation
- Converting every UI test into a browser-driven interaction test
- Setting an aggressive final coverage threshold in the same change; this change establishes the structure needed for later ratcheting

## Decisions

### D1: Test lanes are defined by subject ownership, not just by runner

The repository will treat tests as belonging to one of four lanes:

- `logic`: non-UI behavior in `contracts`, `core`, `domain`, `application`, and appropriate `infrastructure`
- `ui`: presentational and UI-local behavior in `app`, `components`, and `hooks`
- `e2e`: browser-level workbench flows in `e2e/`
- `static`: architecture guards, import scans, and source-policy checks

Both `logic` and `ui` continue to run through `bun:test`; the distinction is conceptual, structural, and coverage-related rather than tool-related.

**Rationale:** The current problem is not “wrong runner,” it is “wrong seam and wrong accounting.” The lane model fixes contributor decision-making and coverage interpretation without introducing a new unit test framework.

**Alternative considered:** Separate lanes only by runner (`bun:test` vs Playwright). Rejected because it would keep non-UI behavioral tests, UI tests, and source-scan policy checks in one undifferentiated Bun bucket.

### D2: Non-UI coverage is measured from the logic lane only

Coverage reporting for the “code that does not touch the UI” goal will be derived from the `logic` lane, not from the entire Bun suite.

This means:

- UI-local tests do not count toward the non-UI target
- static guards do not count toward the non-UI target
- lane scripts and CI reporting need a dedicated non-UI coverage command

**Rationale:** The current suite can report a healthy aggregate percentage while still under-covering orchestration, state, or adapter seams. Restricting the measurement scope prevents static checks and presentational tests from obscuring real non-UI gaps.

**Alternative considered:** Use one repository-wide coverage number. Rejected because it incentivizes adding easy UI or policy tests instead of hard seam tests.

### D3: Seam policy is layer-specific and enforced through exported boundaries

Each non-UI layer gets an explicit testing seam:

- `contracts`: parse, validate, normalize, serialize, and versioned payload behavior
- `core` and `domain`: exported reducers, registries, operation builders, solvers, and state transitions
- `application`: orchestration through ports, sequencing, retries, handoff, and error propagation
- `infrastructure`: adapter conformance against the contract expected by consuming layers

Tests should prefer exported boundaries over private helper reach-in.

**Rationale:** “Test the seam” only works when the seam is named concretely. The layer-specific matrix turns a philosophy into a repeatable decision rule.

**Alternative considered:** A generic rule like “write unit tests close to the code.” Rejected because it reproduces the current drift and does not help decide whether a test belongs at a parser boundary, service port, or UI shell.

### D4: Static policy checks move into a dedicated guard surface

Static checks remain executable and important, but they are migrated out of the behavioral test lane conceptually and physically where practical. The refactor will create a recognizable guard surface such as `test/static/` for cross-cutting checks that scan source trees or enforce import rules.

Module-local behavioral tests remain co-located. Static guards are the exception because their subject is repository policy rather than one module’s runtime behavior.

**Rationale:** Co-location is useful for behavior, but source-scan guards are easier to find, classify, and exclude from non-UI coverage when they live in a dedicated surface.

**Alternative considered:** Leave all guards where they are and rely only on documentation. Rejected because coverage and lane execution would still need special-case exclusions that contributors would not naturally see.

### D5: Shared fixtures are extracted by seam, not by feature area

The refactor introduces shared builders, fakes, and stubs only where a seam recurs across unrelated tests:

- contract payload builders
- service port fakes
- repository/mutation-basis fixtures
- registry composition helpers
- adapter contract assertions

Large feature-local setup stays local unless multiple unrelated tests need it. Cross-cutting helpers should live in a small shared test-support surface, while module-specific helpers can remain adjacent to the owning tests.

**Rationale:** The current suite already has a few good shared seams and many ad hoc local helpers. The goal is not to centralize everything; it is to centralize only the setup that is genuinely about a reusable boundary.

**Alternative considered:** Mandate a global shared fixture library for all tests. Rejected because it would create a new monolith and make tests less readable.

### D6: Migration is path-driven and incremental

The repository will move to lane-aware execution through explicit script targets and path conventions rather than a one-shot rename of every test. The migration sequence is:

1. introduce lane scripts, docs, and guard locations
2. move or reclassify static checks
3. classify `src/` tests into logic or UI execution paths
4. extract repeated seam fixtures in high-churn areas
5. enable non-UI coverage reporting and then ratchet thresholds later

The umbrella `test` workflow remains available, but lane-specific commands become first-class.

**Rationale:** The suite is already large and live. A phased migration preserves developer trust and avoids combining policy work with broad semantic rewrites of stable tests.

**Alternative considered:** Pause feature work and rewrite the full suite in one branch. Rejected because the blast radius is too large and the payoff comes from the structure, not from wholesale rewriting.

## Risks / Trade-offs

- **[Risk] Lane boundaries become performative labels instead of real behavior** → Mitigation: back the lane model with script targets, file placement rules, and explicit coverage reporting so the distinction is executable.

- **[Risk] Existing developer workflows break during reclassification** → Mitigation: preserve an umbrella `test` command, migrate incrementally, and keep the lane commands additive until the new structure is stable.

- **[Risk] Static guard relocation creates noisy diffs with little user-visible value** → Mitigation: move only cross-cutting guards in this change, and leave purely local behavioral tests co-located.

- **[Risk] Shared fixture extraction over-centralizes test setup** → Mitigation: extract only seam-level builders used across multiple unrelated tests; keep feature-local builders local by default.

- **[Risk] Initial non-UI coverage numbers look worse after excluding UI and static tests** → Mitigation: treat that as a more truthful baseline and defer strict thresholds until after the suite has been reclassified.

- **[Trade-off] Some current spec files will be renamed or moved without changing their assertions much** → This is intentional; the immediate gain is clearer suite ownership and measurement, not necessarily different per-file behavior.

## Migration Plan

1. Add lane-aware scripts, docs, and contributor guidance while preserving the current umbrella flows.
2. Create the dedicated static-guard surface and migrate repository-level source-scan checks into it.
3. Reclassify Bun tests by path so `logic` and `ui` execute as distinct suites.
4. Introduce shared seam fixtures for the most repeated non-UI boundaries and convert the highest-value tests first.
5. Add non-UI coverage reporting against the `logic` lane only.
6. Leave threshold ratcheting as a follow-up once the new baseline is visible.

Rollback is straightforward:

- restore the prior script targets
- move static guards back if needed
- remove shared seam fixtures that are not yet widely depended on

Because this change is structural, not data-bearing, no runtime migration or persisted data rollback is required.

## Open Questions

- What should the initial non-UI coverage threshold be once the suite is reclassified: no threshold, informational reporting only, or a modest floor?
- Should the umbrella `test` command run `logic + ui + static`, or should static checks remain opt-in locally and required only in CI?
- Which existing high-churn areas should receive shared seam fixtures first: editor runtime, modeling service/repository flows, or contract/schema builders?
