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

Earlier ticket 01 validation used a whole-directory `node_modules` symlink before the cache risk was discovered. It may have updated main's generated TS/build caches; no main source, tracker or kernel assets were edited, and those shared caches were not rolled back while another agent was active. All final validation used private caches.

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

Mandatory aggregate attempt (bounded by the implementation coordinator):

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

## Integrated blocker follow-up (2026-10-12)

This section supersedes the preserved blocker status above where explicitly noted; **ticket 01 remains blocked**, not completed. Retained integration workspace: `/home/dzervas/Lab/cadara/.pi/worktree/browserless-cli-integration`, bookmark `browserless-cli`. Merge change `xsqsyqxp` has parents `6d21a5d6` (existing integration with first STEP recipe and kernel alias fixes), `89ce23ac` (canonical export loader migration), and `3af86eb2` (empty native Boolean history qualification only). The existing integration tip is an ancestor of both incoming tips. No conflicts occurred; path-restricted tree comparisons confirm exact incoming export/payload files, retained kernel fix, and unchanged split/reference semantics, native shims, binding patches and tracked assets. Only `browserless-cli` was explicitly moved; no other workspace/main/tracker files were edited. During finalization the Boolean agent concurrently attached an empty descendant (`rkrrvkwq`) to integration. Jujutsu automatically rebased that descendant and its bookmark when integration was snapshotted/described; its source tree is unchanged. No other-agent history restoration was attempted.

### Reproductions now fixed

- **Fillet/shell dimension-only rebuild:** composing native aliases now preserves the implicit native-to-public identity bridge after semantic reconciliation. The original real-native consumer assertions pass; regressions also check exact native payload membership, current subshape `IsSame`, and edited width 12 rather than stale width 10. No native rebuild is needed for this TypeScript fix.
- **Disjoint Boolean common:** available operand history can validly have zero final faces. The parser accepts that exact native result while duplicate IDs/incidences and unsupported-history constraints stay strict. The new generated-kernel regression proves successful disjoint common, empty topology, available empty history and zero diagnostics. The original `testCombineRejectsEmptyAndMalformedBodyRoles` assertion is unchanged and passes with the intended no-solid-result diagnostic. No native rebuild is needed for this parser fix.
- **Excluded export spec loader typing:** both mesh rows now use canonical `getDefaultOpenCascadeInstance`, removing the duplicate constructor loader and its incompatible generated-module cast. The explicit export-spec typecheck passes; this does not make STEP export succeed against old assets.

### Native STEP rebuild still required: exact source recipe

`opencascade-recipe.yaml` already contains the required inheritance closure `Interface_Static -> Interface_TypedValue -> MoniTool_TypedValue` (the missing last base is now bound; `Standard_Transient` was already present). Old generated artifacts leave `Interface_Static.IsPresent` / `SetCVal` unresolved in Embind, and the original STEP regression still fails with `occ-export-writer-unavailable`: `STEP writer configuration is not available in this OpenCascade runtime.` Do not work around this in the provider or accept missing output as success.

A subsequent explicitly authorized native build must snapshot **this combined integration source**, not reuse the historical STEP-only stage. From the retained integration workspace, prepare a new stage and run its existing pinned builder on a Docker-capable host:

```sh
# Future source snapshot; neither command was run in this integration follow-up.
bash scripts/stage-occ-build.sh "$PWD/node_modules/.tmp/browserless-cli-combined-step-rebuild"
bash "$PWD/node_modules/.tmp/browserless-cli-combined-step-rebuild/build.sh"
```

The runner uses `donalffons/opencascade.js:2.0.0-beta.b5ff984@sha256:3069f4c2e3ab62bb82d81843bad2c0f8552ee92373208f8f655ef9bf71c0524d`, OCCT `bb368e271e24f63078129283148ce83db6b9670a`, and the existing `regen-patched-bindings.sh`/recipe. No additional shim or generator patch is required by the STEP diagnosis. Retain the entire stage, input/artifact hashes, generated JS/WASM/declarations and conformance/lifetime results. Qualify the original STEP seam and production gates before staging assets into integration; do not overwrite shared/main artifacts.

Native assets were **not regenerated or changed** here. Verified SHA256:

- `public/cadara-occ.js`: `ae18d9482dec22915dd6a9e1256b6b1d241e6ab109c18115c4cffaf4d9229d54`
- `public/cadara-occ.wasm`: `13b060457eeadd9946a3e4c932c5c3b380d17307187db53093b70e988943a524`
- `opencascade-recipe.yaml`: `35c1394ec2b0f783006d469f026386f980a8d1dfb0a0bdb5d683421c3e89109f`

### Split source-owner ambiguity remains unresolved

The d3cd9 sheet-tool successor has exact native correspondence but belongs to two Split output slots; publishing an unqualified single-owner alias would change reference meaning. The source query carries `isFromBackBodyT`; independent rollback evidence says face JZW belongs to captured owner JZT. The special deferred selector does not carry a usable owner witness. Authorized qualification of the existing strict source-to-runtime owner mapper yielded **10 unique, 3 ambiguous, 8 noMatch** among 21 captured sibling faces. Its all-unique/same-owner contract therefore cannot establish JZT's runtime owner. Qualification stopped without retaining any split production/test change. No arbitrary orientation, first/nearest slot, relaxed tolerance, ignored sibling or assertion migration is authorized. A further authoritative correspondence mechanism or input/evidence decision is needed; carrying the captured owner alone would only move the failure. A native STEP rebuild does not resolve this semantic blocker.

### Fixture availability and isolation

The approved ignored `test/fixtures/onshape-captures/9841e486906fa2ce62d74d8e.onshape-capture.json` was absent. Copied **only that existing file** from main to the same integration test path, without displaying contents or reading authentication/secrets. `git check-ignore` confirms it remains ignored; no fixture was committed. This is an environment action, not an importer repair or a native geometry qualification claim.

All checks use integration's real private `node_modules` with per-package links and private `.tmp`, `.cache`, `.vite`, `.vite-temp` directories. No install, shared dependency/cache writes, server, root command, mutating Git operation or native build was used. Jujutsu mutations use per-command `signing.behavior=drop`.

### Fresh integrated verification and excluded-spec gap

Reviewed `docs/testing.md`. Existing **logic** tests cover exported feature/rebuild behavior and real production adapter conformance; **static** checks cover repository policy separately. No new test/assertion edits were made by this merger.

- Combined naming/topology/shared (27) plus feature/payload (45): **5 files / 72 tests passed**. Command: `bunx vitest run src/domain/modeling/occ/topological-naming.spec.ts src/domain/modeling/occ/topology.spec.ts src/domain/modeling/occ/features/shared.spec.ts src/domain/modeling/occ/features.spec.ts src/domain/modeling/occ/native-topology-payload.spec.ts`. Log: `/tmp/cadara-integration-combined-72.log`.
- `bun run test:static`: **21 files / 37 tests passed**, `/tmp/cadara-integration-static-final.log`.
- Export directory + canonical runtime + split-interface query-reader check: **8 files passed / 1 failed; 22 tests passed / 1 failed**, `/tmp/cadara-integration-export-runtime-fixture.log`. Both migrated mesh rows complete before the original STEP assertion fails with the exact unavailable-configuration diagnostic against unchanged assets. Runtime conformance and the query-reader suite pass; the copied fixture resolves that suite's availability failure, not split ownership.
- `bun run typecheck`, `bun run typecheck:specs`, and `bun run lint`: **passed**, `/tmp/cadara-integration-{production-types,ratchet-types,lint}-final.log`.
- Explicit isolated checks of all three affected excluded specs use temporary private configs extending `tsconfig.test.json`, each with its exact spec and `src/vite-env.d.ts`, `exclude: []`, private build info and `--listFiles` inclusion confirmation. Baseline `cee569db` source is compiled against identical merged dependencies/configuration; private baseline copies preserve relative import resolution. Compare diagnostic code/message multisets, not shifted source locations. `/tmp/cadara-integration-explicit-comparison.log` and `/tmp/cadara-integration-explicit-{export,native-payload,topological-naming}-{baseline,current}.log` retain results:
  - Export: **1 baseline error -> 0 current; explicit PASS**, no additions, removed incompatible constructor cast.
  - Native payload: **35 baseline errors -> 34 current**, no additions, removed incompatible constructor cast. Remaining existing errors are not repaired here; this explicit check is not a clean pass.
  - Topological naming: **106 baseline errors -> 117 current, 11 added** in the earlier kernel regression additions. They include missing exported `OpenCascadeNativeTopologyKernelHost` (line 49), possibly undefined body/target accesses, and incompatible `TopAbs_ShapeEnum` typing (line 569). This spec is unchanged from existing integration `6d21a5d6`; the gap predates this two-tip merge, but corrects the kernel handoff's coverage claim. Runtime assertions pass; excluded-spec typing does not. Left for scoped follow-up, not silently repaired by the merger.
- The normal spec ratchet **excludes all three files** and cannot certify them. Explicit comparison exits nonzero for the newly disclosed kernel-spec gap; do not report all touched specs as green.
- Read-only `git diff --check` and exact source-tree/ancestry checks pass. No aggregate repeat was run: multiple previous bounded aggregate attempts/failures are recorded above and in blocker evidence; no fresh whole-suite/UI/E2E success is claimed.

Blocker evidence reviewed: `/tmp/cadara-browserless-cli-{kernel-rebuild,step-export,boolean-topology}-evidence.md` and `/tmp/cadara-browserless-cli-split-ownership-decision.md`. Split qualification replay patch remains external evidence at `/tmp/cadara-split-owner-mapping-probe.patch`, not retained source. Keep integration for native rebuild and semantic-owner follow-up; ticket closure is not authorized.

### Scoped blocker review typing correction (2026-10-12)

The duplicated Standards/Spec P2 source-review regression is fixed in `topological-naming.spec.ts`. The native host type now imports from canonical `native-topology-payload`; the dimension-edit helper explicitly checks bodies and selected targets before use, retaining the existing assertions. `TopExp.MapShapes_1` uses the established `as never` generated-binding enum boundary, matching production topology code. No `any`, suppressions, exclusion changes, shared helper cleanup, or unrelated baseline fixes were introduced. Exact current native payload membership, subshape `IsSame`, and edited width 12 assertions remain intact.

Reviewed `docs/testing.md` and TDD references. The **logic** seam remains public native rebuild and production topology-adapter conformance, not source policy or UI. Naming/topology/shared: **3 files / 27 tests passed**. Production typecheck, normal spec ratchet, and lint passed. Normal spec ratchet still excludes this spec and is not its certification.

Explicit excluded-cleared configs include the exact spec and `src/vite-env.d.ts`, use private build info, and verify `--listFiles` inclusion. Baseline `cee569db` and final compile against identical current dependencies/configuration; diagnostic code/message multisets ignore shifted source locations. The pre-fix check reproduced the disclosed regression. Final comparison: **106 baseline -> 98 final diagnostics, zero added**. Both explicit compiler invocations still exit 1 for remaining baseline errors; only the diagnostic-delta check passes. The eight baseline removals result from meaningful narrowing within the same requested dimension-edit helper, not repairs to the unrelated shared helpers or other tests. Evidence: `/tmp/cadara-blocker-explicit-{red,baseline,current,comparison}.log`; replay script `/tmp/cadara-blocker-explicit-compare.py`.

Mandatory aggregate attempt: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3117 PLAYWRIGHT_WEB_SERVER=0 timeout --signal=TERM --kill-after=10s 180s bun run test:all` **timed out, exit 124**, during logic (`/tmp/cadara-blocker-aggregate.log`). Aggregate lint, normal application build and spec ratchet completed; before interruption the log showed the original export failure and the zero-test query-reader fixture suite. No final logic summary or UI/static/E2E run was reached, so no aggregate pass is claimed. The fixture was not copied for this scoped repair. MaxListeners warnings remain outside scope.

Validation uses a workspace-local real dependency directory with package links, private caches and copied unchanged production JS/WASM. No native staging/build, asset regeneration, tracker closure, main or other workspace edits occurred. Native STEP still requires the combined-source recipe rebuild and conformance qualification described above. Split source-owner ambiguity remains unresolved; this source typing repair changes neither blocker nor ticket 01 status.

