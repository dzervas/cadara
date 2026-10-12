# Browserless CLI kernel migration: partial ticket 01 handoff

## Scope and status

This is a **partial ticket 01 handoff**, not completion of ticket 01 or the full CLI. Native geometry qualification remains blocked and needs explicit user scope approval. No geometry assertions were weakened, skipped, or repaired here; no subsequent CLI tickets were implemented.

Ticket 01 revision `21d6b454` migrated filesystem startup to the generated production JS/WASM, removed the stock/enumeration fallback, and shared native capability validation. The review-fix workspace is based on integration `browserless-cli` at `dcd49028` (parent of the review change). Its only actionable review finding was Standards P2: adapter/bootstrap code in domain imported infrastructure, while the filesystem adapter imported initialization back from that same domain module. Spec review had no new findings.

The bounded fix follows `docs/architecture/layering-adr.md`:

- `src/infrastructure/occ/runtime.ts`: browser/filesystem selection, browser asset loading, instance caching/retry/reset.
- `src/infrastructure/occ/initialization.ts`: shared generated-module initialization, dynamic libraries, production native method and planar-binding validation; no concrete adapter selection or asset I/O.
- `src/infrastructure/occ/filesystem-kernel-runtime.ts`: filesystem JS/WASM adapter, now imports shared initialization directly.
- `src/domain/modeling/occ/runtime.ts`: retained neutral types, asset-version helpers, native capability helpers only. No infrastructure import or compatibility re-export.
- Consumers use canonical imports; neutral type/capability imports remain unchanged. The existing worker fixture mock targets the new bootstrap owner.

Dependency direction is now `bootstrap -> filesystem adapter -> initialization -> neutral runtime`, with `bootstrap -> initialization` for the browser path. Initialization does not import the bootstrap or filesystem adapter. This does not claim wholesale migration of existing OCC workers/modeling adapters or unrelated legacy domain layering.

## Isolation and test policy

All edits and commands ran from `/home/dzervas/Lab/cadara/.pi/worktree/browserless-cli-review-fixes`. Main, integration working files, trackers, and other workspaces were not modified. The local `node_modules` is a real private directory, modeled on ticket 01: dependency/package and binary symlinks point to installed dependencies; `.tmp`, `.cache`, `.vite`, and `.vite-temp` are private directories, not shared cache symlinks. Safe generated `public/cadara-occ.js` and `.wasm` were copied from ticket 01. No dependency installation or shared server was used.

Reviewed `docs/testing.md`, the layering ADR, code-review skill, TDD skill, `tests.md`, and `mocking.md`. Announced lanes before test edits: **static** for dependency/policy guards and existing **logic** for public runtime/production adapter and worker conformance. Existing Vitest runner retained. Runtime logic specs stay at the existing approved seam rather than moving non-UI coverage into the guide's UI-classified infrastructure OCC folder.

Red-green: the new static cycle guard failed against the original domain-to-infrastructure import (1 failed / 2 passed; `/tmp/cadara-review-red.log`). After separation it passes. An initial targeted run caught the stale worker mock import (2 failed / 40 passed); updating its canonical mock target restored all tests. Initial spec typecheck caught the same stale mock target; final spec typecheck passes. No production behavior/assertion changed to satisfy those checks.

## Review-fix checks

Commands below run from the review workspace. Logs are local diagnostics; this document records durable results.

```sh
bunx vitest run src/domain/modeling/occ/runtime.spec.ts \
  src/domain/modeling/occ/sketch-derivation.worker.spec.ts \
  src/domain/modeling/occ/production-asset-conformance.spec.ts \
  src/domain/modeling/occ/topology.spec.ts \
  src/domain/modeling/occ/baked-body.spec.ts \
  src/domain/solver/sketch-constraint-solver-adapter.spec.ts \
  test/static/occ-production-runtime-boundary.spec.ts
bun run test:static
bun run typecheck
bun run typecheck:specs
bun run lint
bun run build
bun -e 'import {getDefaultOpenCascadeInstance} from "./src/infrastructure/occ/runtime.ts"; import {probeOpenCascadeNativeTopologyKernelCapabilities} from "./src/domain/modeling/occ/runtime.ts"; console.log(probeOpenCascadeNativeTopologyKernelCapabilities(await getDefaultOpenCascadeInstance()).kind);'
```

- Targeted final run: **7 files / 59 tests passed**, including **11 worker tests** and **3 static boundary tests**; `/tmp/cadara-review-targeted-final.log`.
- Static suite: **21 files / 37 tests passed**; `/tmp/cadara-review-static.log`. The final targeted rerun also covers the subsequent strengthening of the same guard to include migrated initialization/bootstrap sources.
- Production typecheck: passed; `/tmp/cadara-review-typecheck.log`.
- Final spec typecheck: passed; `/tmp/cadara-review-spec-types-final.log` (includes changed specs).
- Lint: passed, including final rerun; `/tmp/cadara-review-lint.log`, `/tmp/cadara-review-lint-final.log`.
- Build: passed, **3349 modules transformed**; `/tmp/cadara-review-build.log`. Existing filesystem-only Node externalization/public-URL warnings, chunk-size and Typia timing warnings remain; these are not geometry qualification.
- Direct Bun startup: native topology capability **`available`**; `/tmp/cadara-review-bun-startup.log`.
- Read-only `git diff --check`: passed (Jujutsu workspace; no mutating Git used).

Mandatory aggregate attempt (bounded per user instruction):

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3102 PLAYWRIGHT_WEB_SERVER=0 \
  timeout --signal=TERM --kill-after=10s 300s bun run test:all
```

**Aggregate result: timed out at 300 seconds, exit 124**, during logic; `/tmp/cadara-review-test-all.log`. Lint, production typecheck/build, and spec typecheck completed successfully within the aggregate. Before interruption, it reported **four failed tests**: the two known fillet/shell dimension-edit rows, the disjoint-combine row, and the sheet-export wrapper. It also reported the known `split-interface-face-query-reader.spec.ts` zero-test/fixture suite. No final logic pass count or complete failure summary was emitted, so none is inferred. Aggregate UI/static/E2E stages were not reached. Dedicated static and targeted results above remain independent passing evidence. MaxListeners warnings also appeared and were not repaired outside scope. Port 3102 is isolated; no server was started and no shared E2E server was used. No fresh UI/E2E pass is claimed.

Final boundary-only rerun: **1 file / 3 tests passed**, `/tmp/cadara-review-static-final.log`, followed by passing final lint and spec typecheck. The aggregate interruption is not evidence that the pure region-extraction or native kernel hung; it is the approved runtime budget.

## Preserved blockers and reproducible follow-up

The following are **prior verified ticket 01 findings**, not repaired in this review slice. Original evidence is `/tmp/cadara-browserless-cli-01-evidence.md`. Reproduction entrypoints below preserve the production assertions and run with the custom copied assets, from this workspace or a merged workspace with the same assets. Do not interpret a timeout as proof of a native OCC hang.

1. Dimension-only rebuilt fillet and shell fail native transaction `IsDone`: `Native OCC fillet failed to build.` / `Native OCC shell failed to build.` Ticket 01 isolated both failures (2 failed, 21 skipped), `/tmp/cadara-01-production-defects.log`.

   ```sh
   bunx vitest run src/domain/modeling/occ/topological-naming.spec.ts \
     -t 'durable naming qualification preserves a moving fillet edge through a dimension-only sketch edit|durable naming qualification preserves a changed shell face through a dimension-only sketch edit'
   ```

2. Disjoint combine intersect reports `finalFaces: must not be empty when Boolean operand history is available.` instead of the explicit empty-result diagnostic. Ticket 01 direct Bun reproduction: `/tmp/cadara-01-combine-defect.log`. Existing asserted reproduction is the feature-suite row `testCombineRejectsEmptyAndMalformedBodyRoles`:

   ```sh
   bunx vitest run src/domain/modeling/occ/features.spec.ts \
     -t 'testCombineRejectsEmptyAndMalformedBodyRoles'
   ```

3. Sheet STEP export reports `occ-export-writer-unavailable`: `STEP writer configuration is not available in this OpenCascade runtime.` Ticket 01 direct Bun reproduction: `/tmp/cadara-01-sheet-defect.log`. Existing asserted reproduction:

   ```sh
   bunx vitest run src/domain/export/occ-export-capabilities.spec.ts
   ```

4. d3cd9 split-interface sheet-tool successor alias resolves zero output faces where exactly one is expected. Prior aggregate finding; retain the entire real-OCC assertion:

   ```sh
   bunx vitest run src/domain/import/onshape/apply-pipeline.spec.ts \
     -t 'd3cd9 applies the complete prepared action sequence through real OCC with zero diagnostics'
   ```

5. Capture fixture `test/fixtures/onshape-captures/9841e486906fa2ce62d74d8e.onshape-capture.json` is absent in the stable workspace. Its ignored presence in main does not qualify this workspace. Not copied or repaired here.
6. Prior broad offset suite bounded attempt timed out after 120s/21 passing rows, including a 61s certification row. Three affected real-OCC rows independently passed:

   ```sh
   bunx vitest run src/domain/editor/sketch-offset-live-cutover.spec.ts \
     -t 'g5b-7|REQUIRED-1 \(OCC\)|G19c \(OCC\)' --reporter verbose
   ```

Prior ticket 01 aggregate: 267 files / 3831 tests passed with six failed tests, the missing-fixture suite, and a worker error after interrupting the long-running pure region-extraction worker. One failed worker fixture was subsequently migrated and independently passed; a later aggregate rerun was interrupted for dependency-cache isolation, not a pass. Prior targeted runtime/topology/baked-body/asset/solver checks passed **5 files / 45 tests**, worker **11 tests**, static **21 files / 36 tests**, UI **76 files / 322 tests**, and isolated editor E2E **1 test** on owned port 3101. Those are prior evidence, not fresh full-suite results for this review revision.

Review handoff bookmark: `browserless-cli/review-fixes`; change ID `runptrkluqnuxtrqrslzursvqqosruxk` (the final commit identifier is supplied in the handoff report). Integration ancestry is rechecked immediately before handoff; an unchanged `dcd49028` requires no merge. The bootstrap and initialization function bodies were mechanically compared with the integration parent and match exactly; the behavior change is dependency ownership, not kernel logic.

The parent owns merge, marking ticket 01 blocked, and eventual workspace cleanup. This workspace is left intact for handoff. No tracker closure or full CLI completion is authorized by the boundary fix.
