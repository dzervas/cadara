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
  src/domain/modeling/occ/sketch-derivation.worker.isolated.spec.ts \
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
   bunx vitest run src/domain/import/onshape/apply-pipeline.heavy.spec.ts \
     -t 'd3cd9 applies the complete prepared action sequence through real OCC with zero diagnostics'
   ```

5. Capture fixture `test/fixtures/onshape-captures/9841e486906fa2ce62d74d8e.onshape-capture.json` is absent in the stable workspace. Its ignored presence in main does not qualify this workspace. Not copied or repaired here.
6. Prior broad offset suite bounded attempt timed out after 120s/21 passing rows, including a 61s certification row. Three affected real-OCC rows independently passed:

   ```sh
   bunx vitest run src/domain/editor/sketch-offset-live-cutover.heavy.spec.ts \
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

## Retained integration: native rebuild operational handoff (2026-10-12)

The final merger created a new integration change directly atop reviewed blocker repair `676faf60065c67d1c9693acb678b018dc3c561a8` (parent `2aab76f453d0b41e342556141923ae90c99be696`). Only `browserless-cli` was explicitly advanced. No ancestor was edited, rebased or squashed. The integrated delta is confined to regression-spec typing and this documentation; no production behavior changes or conflicts.

The already prepared, ignored stage is retained at `/home/dzervas/Lab/cadara/.pi/worktree/browserless-cli-integration/.scratch/occ-step-binding-rebuild`. This supersedes the earlier instruction to prepare another stage: **all 22 manifest input hashes passed**, and byte comparisons against current integration confirm the recipe, complete shim and binding-patch file sets, regeneration script and all five conformance/probe scripts match. The recipe includes `MoniTool_TypedValue`; this is the combined current native source, not the historical STEP-only snapshot. Stage inputs were not rewritten. Evidence: `/tmp/cadara-final-merger-stage.log`.

From the **main repository root**, the user can run the retained pinned Docker builder on a Docker-capable host:

```sh
bash .pi/worktree/browserless-cli-integration/.scratch/occ-step-binding-rebuild/build.sh
```

The configured Docker socket `/run/user/1000/docker.sock` is missing in the agent environment. No native build was attempted, no privileged command or service start was used, and no native output was produced or installed. Preserve the entire stage and return its generated artifacts, hashes and conformance/lifetime results for qualification before any asset installation. Main/generated binaries were not overwritten. The ignored capture fixture and existing JS/WASM remain preserved, with the asset hashes recorded above unchanged. **STEP and split ownership remain blocked; ticket 01 is not complete.** A successful native build alone would not qualify STEP or solve split owner ambiguity.

Fresh final integration checks (private workspace-local caches):

- Reviewed `docs/testing.md`; existing **logic** lane covers public native rebuild and real production topology-adapter conformance. No test edits by this merger. Naming/topology/shared: **3 files / 27 tests passed**, `/tmp/cadara-final-merger-27.log`.
- `bun run typecheck` and `bun run typecheck:specs`: **passed**, `/tmp/cadara-final-merger-{production,spec}-types.log`. Normal spec ratchet still excludes the naming spec.
- Explicit naming-spec baseline comparison replayed using the existing evidence script adapted only to integration paths and private configs/caches: `cee569db` **106 -> 98 diagnostics, zero added**, comparison exit 0. Exact spec inclusion verified with `--listFiles`, `exclude: []`, identical current dependencies/configuration, diagnostic code/message multiset comparison. Both compiler invocations exit 1 for remaining baseline errors: this is **no typing regression**, not a clean explicit compiler pass. Evidence: `/tmp/cadara-final-merger-explicit-{baseline,current,comparison}.log`; replay `/tmp/cadara-final-merger-explicit-compare.py`.
- Read-only `git diff --check`, scoped source delta and conflict checks passed. No full aggregate repeat, native build, fresh broad-suite/UI/E2E qualification or tracker closure is claimed.

## Built STEP closure: bounded guard qualification (2026-10-12)

The user built the retained combined-source stage. Its original lifetime result
was **14 pass / 1 error**: the actual failure was the obsolete
`registry-abi-and-declarations-unchanged` v8 byte-hash guard, not the printed
`memory access out of bounds`. The latter is the intentional illegal-release
negative witness: deleting a NamedShape attribute handle after its document
must trap; deleting the handle first completes 20 iterations. That witness,
raw-destructor inventory, borrowed-pointer audit and lifetime slopes are unchanged.

An independent old/new registration audit proved exactly **58 added MoniTool
registrations**, plus `Interface_TypedValue`'s base resolving from
`?unbound:19MoniTool_TypedValue` to `MoniTool_TypedValue`. Removing only that
explicit extension and reversing that one base resolution recovers the original
ABI SHA256 `5c3617ab8ab5a10d41a5351e2ded5b472a19ece74880ece1e7a7c700bde87d8d`.
All **477 existing classes and 12 enum declaration blocks are byte-identical**;
only their top-level ordering changes. The three added MoniTool classes and
three instance entries are pinned in `scripts/occ/step-binding-extension.json`.
Instance entries are reordered, but all existing signatures and remaining type
aliases/initializer declarations are preserved.

`lifetime-abi-policy.mjs` retains the original ABI/declaration fingerprints and
checks the explicit approved extension rather than accepting a new build hash.
The declaration baseline is independently canonicalized by sorting intact
class/enum blocks and instance entries (not members), preserving declaration
ownership. Its SHA256 is
`42ed68c0445500c9b617ebbae8acdc8a77f13d0f8e27e45e9ba37cc4dd40c7c2`.
Any other signature, base, enum, registration or extension change fails closed;
registry and declarations must agree on whether the extension exists.
Future stage preparation copies both policy files beside the probe.

Run the **modified repository probe**, not the immutable stage's historical
probe, with an explicit stage directory and a result path outside the stage:

```sh
node scripts/occ/native-lifetime-conformance.mjs /absolute/retained-stage /tmp/lifetime-results.json
node scripts/occ/probe-custom-build.mjs /absolute/retained-stage /tmp/conformance-results.json
```

New assets: JS SHA256
`1cd537f7922268d496ae48b4813607375cdd17e799e1f10bde1671e0bf278cbf`, WASM
`31627620c515151af8f295cbe3a2c28f4fbdc10ab3224daf13ef2b3911cb47d2`, declarations
`bde44bfda1df5dbcbecfbb2ab0065779cd7a815fa87e9c4349cae55d833177ce`, registered ABI
`ab7eb7cf2cd2f7d4f8f7d0479db6d738d569a8d2233dba1445e31e5d8a1bae67`.
Fresh staged probes: **15 lifetime pass / 0 error**, **13 conformance pass / 0
error**, exact native precision retained. The original assets pass the retained
ABI/declaration policy but still fail the full destructor/lifetime gate (**5
pass / 10 error**, including no-op destructors and retained-wrapper slopes).
Accepting the original public signatures does not accept its unrepaired native
lifetime behavior. Static declaration-policy regression
coverage includes unchanged/reordered baseline, approved extension, altered
existing/added signatures, partial extension, missing instance entry and enum
or declaration-ownership drift. Reviewed `docs/testing.md`; this is **static
policy coverage**, separate from the existing **logic adapter conformance**.

**STEP remains blocked; do not promote these artifacts.** Filesystem startup
reports native topology `available`; `Interface_Static.IsPresent` and `SetCVal`
now successfully configure AP242DIS/MM. The original production sheet STEP
regression then fails at `STEPControl_Writer.Transfer` with
`UnboundTypeError: ... 21IFSelect_ReturnStatus`. A direct filesystem-loader /
production export-capability check reproduces it for a solid too. The old and
new registries both leave that return enum unbound for `Transfer` and `Write`;
this is an existing missing binding exposed after fixing the inheritance closure,
not an unexpected ABI delta. No valid STEP header was produced. No recipe,
provider fallback, assertion weakening or split-owner change is included here.
Artifact promotion/version updates and any additional native recipe repair
remain separately owned by the parent. Stage inputs, outputs and historical
results remain immutable; qualification results are external evidence.

Validation used private per-package dependency links/caches and temporarily
copied new JS/WASM/declarations into the qualification workspace only; its public
assets were restored before handoff. New-asset targeted checks: **104 pass / 1
STEP failure** across eight files; focused policy/borrowed-pointer/runtime-boundary
and provider checks: **11 pass**. Final static suite with restored assets:
**22 files / 43 tests pass**. The new static spec is explicitly typechecked with
`exclude: []` and file inclusion verified: absent-at-baseline **0 -> 0**
diagnostics. Mandatory `test:all` with new assets passed lint/build/spec typing,
then timed out at **300 seconds / exit 124** during logic; the log showed STEP,
d3cd9 and the zero-test query-reader fixture suite, without a final logic summary.
UI/static/E2E aggregate stages were not reached. A separate new-asset static run
correctly rejected the still-old asset-version stamp; no version stamp was changed
to imply promotion. Final restored-asset static validation passes. No full-suite,
STEP-header, browser qualification or ticket closure is claimed.

### Follow-up source repair: STEP return-status dependency (not built)

A complete audit of the **used production export path**, against the retained
staged registry/declarations and pinned OCCT headers, finds only one unresolved
binding type: `IFSelect_ReturnStatus`, returned by both `STEPControl_Writer.Transfer`
and `.Write`. Independently calling each on the staged runtime reports that same
unbound type. `STEPControl_Controller.Init`, `Interface_Static.IsPresent`/`SetCVal`,
`STEPControl_Writer_1()` and `Message_ProgressRange_1()` resolve and run;
`STEPControl_StepModelType.STEPControl_AsIs` is bound with value 0. Writer disposal
runs successfully. `FS.analyzePath`, `FS.readFile` and `FS.unlink` are Emscripten
filesystem functions, not Embind bindings with unresolved C++ types; analysis
reports no STEP file, so the real read/status-success paths remain unqualified.
The provider checks native returned status `.value === 1` (header enum
`IFSelect_RetDone`), reads UTF-8 output and removes it in `finally`.

The recipe now explicitly binds `IFSelect_ReturnStatus`, with its Transfer/Write
return dependency documented beside the symbol. This adds no translator, wrapper,
shim, fallback or JS enum/status patch. Unused WorkSession/model/history methods
are not dependencies of this call path and are not bound speculatively.
Pinned header: OCCT `bb368e271e24f63078129283148ce83db6b9670a`,
`src/IFSelect/IFSelect_ReturnStatus.hxx`: RetVoid/RetDone/RetError/RetFail/RetStop
have successive values 0/1/2/3/4. Generator `bindings.py` at opencascade.js
`b5ff984` matches the build's pinned pre-patch SHA256; its enum emitter explicitly
binds those five values. `generateBindings.py`, `compileBindings.py` and
`buildFromYaml.py` match the actual regeneration receipt hashes. Regeneration
receipts show Init/interface/progress sources unchanged and the writer changed
only by removing its placement-delete no-op specialization, not by signature edits.

**Future ABI audit is pending; the strict lifetime policy is unchanged.** The
source-derived anticipated declaration is one enum block plus one instance entry;
existing method declarations stay unchanged. The registered-type inventory
predicts five existing return-type resolutions (Transfer/Write plus the three
controller transfer methods already referencing the same enum), not new methods.
The next build must independently demonstrate the enum registration metadata and
values, those exact resolutions and no unrelated drift before the policy can
approve them. The current stage contains no compiled/generated IFSelect binding;
no unsigned/size metadata or future artifact fingerprint is accepted by analogy.
A focused static regression ensures even the header-derived future enum
declaration remains rejected until audited. Thus a rebuilt stage can correctly
fail the old policy gate while awaiting this independent review; that failure is
not permission to skip the lifetime probe or update whole-build golden hashes.

No native compilation, new stage, artifact promotion or real STEP success is
claimed. The user's retained stage remains immutable and still throws on Transfer
and Write. After review, the parent prepares the combined source snapshot; the
builder must return input/artifact/receipt hashes, built `cadara-occ.d.ts`, and
`binding-regeneration/IFSelect_ReturnStatus.original.cpp` plus
`IFSelect_ReturnStatus.regenerated.cpp`. The regeneration script copies those
exact sources from its existing symbol/relative-path targets only when the enum
is recipe-bound, after the unchanged destructor-only acceptance checks; both
filenames are included in `binding-regeneration/receipts.sha256`. No generated
JSON declaration filename or full binding-source archive is assumed. These
outputs support the independent enum ABI audit; they do not approve a new binary.
Source-only receipt checks cover enum-bound copying, no-enum omission and rejection
before copying when acceptance fails; this does not execute the native builder.
Then rerun the original real sheet/solid export seams (native
schema/unit setup, successful status, real Part 21 header, read/remove output),
complete registry/declaration audit, and unchanged native lifetime/precision gates.
The expected illegal-release child trap and lifetime slopes are preserved.

Reviewed `docs/testing.md`; the two new tests are **static** recipe/ABI-policy
checks, not claims of native export behavior. Dependency guard red: **1 failed /
6 passed** before the recipe edit. Final focused checks: **2 files / 11 pass**;
full static suite: **22 files / 45 pass**. Explicit changed-spec comparison against
`80029bb7`: **0 -> 0** diagnostics with exact file inclusion and `exclude: []`.
Production typing, normal spec typing, lint, script syntax and diff checks pass.
The existing real production export/provider seam remains red against the user's
read-only stage. No new logic assertions, aggregate repeat or E2E claim; parent
owns final combined validation after review and rebuild qualification.

## Audited gate merge and next immutable status build (2026-10-12)

Integration preserves `80029bb7`, `771b5698` and the source-only enum receipt
closure `100ef59e`, above former integration `b09b0606`. The receipt closure
leaves the 88 changed-destructor-only acceptance and all-other-identical rule
unchanged; independent source-only checks confirm enum-bound copies/checksums,
no-enum omission and failure before copying. These are not native build results.
Only the integration bookmark `browserless-cli` is explicitly advanced; no
ancestor, sibling or default-workspace history is rewritten.

**The existing `.scratch/occ-step-binding-rebuild` remains immutable.** Its 22
input hashes and three artifact hashes still verify. Against that actual binary,
the audited repository policy has already qualified **15 lifetime checks and 13
native conformance checks**, including the expected unsafe-release trap. Both
STEP Transfer and Write remain uncallable due to the unbound status enum. Neither
those artifacts nor current public assets are promoted or overwritten.

A separate, fresh source snapshot is now prepared at:
`/home/dzervas/Lab/cadara/.pi/worktree/browserless-cli-integration/.scratch/occ-step-status-rebuild`.
All **24 input hashes** verify, and the mapped recipe/shim/patch/regeneration/probe
inputs match integration byte-for-byte. This snapshot contains the MoniTool
inheritance closure **and** `IFSelect_ReturnStatus`, the audited policy plus its
explicit Moni inventory beside the probe, and the conditional checksummed enum
CPP receipt outputs. It contains no built artifacts. Its `inputs.sha256` SHA256 is
`b7d8e4cc35178f5ae95c48f0a5092ad71640a0e830f3c2d1dd719c8a218ed3a4`.

On the user's Docker-capable host **outside the agent sandbox**, run:

```sh
bash /home/dzervas/Lab/cadara/.pi/worktree/browserless-cli-integration/.scratch/occ-step-status-rebuild/build.sh
```

Return the entire new stage, including builder/toolchain identity, input/artifact
hashes, generated-binding receipts/diff, built JS/WASM/declarations and the exact
`IFSelect_ReturnStatus.original.cpp` / `.regenerated.cpp` receipts. Preserve both
stages. The strict policy intentionally rejects the unseen enum extension until
its actual enum metadata, five values, five existing return-type resolutions and
preserved baseline declarations/registrations are independently audited. Do not
relax the gate or claim the next guard will pass. Errors printed by the expected
unsafe-release child are its negative witness, not a positive-case failure;
interpret the individual check results. Real sheet and solid/provider Transfer,
Write, RetDone, nonempty Part 21 header, filesystem cleanup, native lifetime and
precision qualification remain required before any promotion. Compilation alone
is insufficient, and ticket 01 remains blocked.

Fresh combined-source verification uses integration-local per-package dependency
links and private caches, with unchanged original public assets and the existing
ignored capture fixture retained. Reviewed `docs/testing.md`; no tests were edited
by this merger. The **static** lane covers recipe/ABI and post-acceptance receipt
policy, not real native STEP behavior: **22 files / 46 checks pass**. Production
typecheck, normal spec ratchet, lint, Bash/Node and embedded Python syntax checks
pass. Explicit parent `771b5698` / current static-spec compilation uses exact file
inclusion, `exclude: []`, private build info and `--listFiles`: **0 -> 0 diagnostics**,
both compiler invocations pass. Source-only receipts pass enum-bound, no-enum and
acceptance-failure fixtures; removing only receipt additions recovers the parent
regeneration script byte-for-byte. No fresh heavy native probe, compilation or
browser/server qualification is claimed.

Mandatory combined `PLAYWRIGHT_WEB_SERVER=0 timeout --signal=TERM --kill-after=10s
180s bun run test:all` exited **124**, during logic. Aggregate lint, production
build and normal spec typing completed; logic started but produced no completed
test rows or summary before interruption. Aggregate UI/static/E2E were not
reached; no whole-suite pass or fresh logic result is inferred. Dedicated static
and type/lint/source-only results above remain separate evidence. Logs:
`/tmp/cadara-gate-test-all.log` and `/tmp/cadara-gate-exits.log`. Existing build
externalization/chunk/plugin-time and MaxListeners warnings remain outside scope.

### Split memo correction: no owner bridge qualified

The primary-source memo
`/tmp/cadara-browserless-cli-onshape-split-primary-source.md` records official
Onshape `qSplitBy` front/back semantics relative to the split tool surface normal
(`https://cad.onshape.com/FsDoc/library.html#qSplitBy-Id--boolean`). This does not
prove the undocumented compressed `isFromBackBodyT` encoding or equivalence to a
reconstructed OCC occurrence orientation. Independent investigation
`/tmp/cadara-browserless-cli-split-owner-semantics-research.md` corrects the earlier
qualification boundary: **post-Extrude 6 source / post-Split 1 native** produced
the recorded 10 unique / 3 ambiguous / 8 noMatch counts. They are valid
cross-boundary observations, not a valid disqualification of producer-boundary
owner mapping. Post-Split 1 JZT has 13 siblings excluding JZW, not the consumer's
21. No corrected same-boundary native qualification or source-to-output owner
bridge has been established here. Split remains unresolved; no weaker voting,
orientation guess or original assertion change is authorized by this correction.

The meaningful reviewed source/docs change retains `browserless-cli`; integration
is left on a new empty working change above it. Workspaces, tracker, both ignored
stages, fixture and assets remain for the parent/user handoff.

## Compiled STEP status enum qualification (2026-10-12)

The user returned the new `occ-step-status-rebuild` stage. Its historical
**14 pass / 1 error** again identifies the strict registry/declaration policy,
not the expected illegal-release child trap. Independent read-only auditing
verified all 24 inputs, three artifacts and ten receipt checksums. The retained
original/regenerated enum CPP files are byte-identical, SHA256
`e133595a986bc38735cd4084a601ddecdb7ed4228a6d22c790a1ebdb1d57f58f`, matching
the enum source receipt. All 151 earlier generated source records are unchanged.
The pinned OCCT header and actual CPP bind exactly RetVoid/Done/Error/Fail/Stop
with values 0/1/2/3/4. Emscripten 3.1.14's `enum_` registers native `sizeof` and
underlying-type signedness; the measured compiled registration is size 4,
unsigned. Its pinned LLVM enum selection chooses unsigned int for these
nonnegative values, with 32-bit int and no short-enum compilation flag.

The actual registry has exactly six additions (one enum and five values) and
five existing return-type resolutions: Writer Transfer/Write, STEP controller
TransferWriteShape, and XS controller TransferWriteShape/TransferWriteTransient.
The approved Moni inventory remains exactly 58 entries. All other existing
registrations, 480 class blocks, 12 enum blocks, instance entries and aliases
are unchanged. Removing only the two approved extensions and reversing their
explicit resolutions recovers the original v8 ABI and canonical declaration
fingerprints above. `step-binding-extension.json` now pins this audited enum
inventory alongside Moni, rather than accepting a new whole-build hash.
Registry/declaration presence must agree independently for each extension;
wrong enum metadata/values, changed signatures, partial extensions and unrelated
drift still fail closed.

Fresh repository probes against the immutable new stage pass **15/15 lifetime**
and **13/13 native conformance** checks, including exact precision. The public
lifetime probe preserves stdout JSON, result files and every native gate, and
adds a stderr summary naming actual failed cases and explicitly labeling the
expected unsafe-release trap PASS (safe order completes 20 iterations).

**Native STEP output is now qualified at the production filesystem/export seam.**
The unchanged sheet regression passes. Real sheets and solids exported through
the shared filesystem loader and production STEP provider succeed for default
AP242/mm and AP214/AP203 variants: native Transfer and Write return RetDone=1,
nonempty ISO-10303-21 payloads contain the corresponding FILE_SCHEMA and mm
SI_UNIT, and real files are read and removed. This is not an enum-presence-only
claim. No provider fallback, new binding, native rebuild or split-owner repair
was introduced. Both user stages and their historical results remain immutable.

Reviewed `docs/testing.md`: updated **static** tests cover the exported policy
and report contract; unchanged **logic** tests cover real production adapters.
Qualification temporarily copies new assets only into the qualification
workspace, then restores original assets. Asset/version promotion remains the
parent's responsibility after review; this source-only change does not qualify
a new checked-in stamp, close ticket 01, or resolve the separate split ownership
blocker. Final targeted qualification passes **10 files / 114 tests**; restored-
asset full static passes **22 files / 49 checks**. Exact changed-spec compilation
with exclusions cleared is **0 baseline -> 0 final diagnostics**; typing and lint
pass. Mandatory `test:all` with new assets and an owned isolated server times out
at **300 seconds / exit 124** during logic after lint/build/spec typing pass;
it reports a split-interface history failure, without a complete logic summary.
Aggregate UI/static/E2E are not reached. No whole-suite/browser pass is inferred;
the temporary new-assets static stamp failure is expected and the stamp remains
unchanged. Both stages' manifests still verify and original public hashes are
restored before handoff.

## Reviewed enum source and immutable asset promotion (2026-10-12)

Integration uses a distinct new change atop reviewed enum source `119f5dec`
(Standards and Spec reviews: zero findings). Only the immutable new stage
`.scratch/occ-step-status-rebuild` supplies the promoted JS/WASM/declarations;
main, sibling workspaces, both stages and historical probe logs/results are not
promotion destinations. All 24 input, three artifact and ten receipt hashes
verify before and after promotion. Promoted SHA256 values are:

- JS: `8933159b3f88e564fe4e35e968ff73f93cf81280178be1598d6a340d1b4e7e16`
- WASM: `6350099253e8b379f32521df6881bb95cd1929122aa948e662f3c2279c856d4e`
- declarations: `d196d263cd2872ed64b49f8e2ba1dbe042f3dc4e67360b835b6ea203578cd7b6`

The central `OCC_ASSET_VERSION` is the actual JS SHA256 followed by `-` and
actual WASM SHA256. This supersedes the source-only promotion pending status
above, not the preserved historical results. Original-v8 fingerprints and exact
enum/Moni extension inventories remain the policy: no whole-build gold hash,
provider workaround, source-owner repair or native rebuild is introduced.

Fresh integration default filesystem loading and production STEP provider
qualification export real sheets and solids for AP242/mm (provider default),
AP214 and AP203. All six exports return native RetDone=1 for Transfer and Write,
contain complete ISO-10303-21 output with the respective FILE_SCHEMA and mm
SI_UNIT, and read/remove the actual native files. The enum-only source/ABI gate
is closed; ticket 01 is **not closed** and global all-green is not claimed.
The separate three split-owner fixes (`9bd1b551`, reviewed separately at
`ba953ebf`) are not merged here; the preexisting 9841/JHo history failure remains
a separate blocker. Existing fixture copies are retained.

Fresh promoted-asset probes pass 15/15 lifetime and 13/13 native conformance;
full static passes 22 files / 49 checks, and unchanged targeted production
export/runtime/topology/naming/features/query tests pass 9 files / 141 tests.
The existing real-browser runtime regression passes bootstrap, persisted native
geometry reload and face selection. An additional real-browser production-loader
smoke initializes the new native kernel and exports a complete AP242/mm solid
with native Transfer/Write RetDone=1. Actual runtime requests use the central
cache-version stamp for both assets; the browser independently hashes those
same immutable served URLs to the exact promoted JS/WASM values above. No fake
kernel or response interception is used. This is browser smoke qualification,
not a full UI/E2E-suite pass. Chromium's unavailable worker inspector-response
bodies initially failed the hash observer, not the kernel; preserved diagnostics
and the corrected browser-side crypto verification are in the merger evidence.

Production typecheck, normal spec ratchet and full lint independently pass.
Mandatory `bun run test:all` exits 124 at the exact 300-second bound during logic,
after lint/build/spec typing complete. It reports the existing 9841 Sketch 3/4
split-interface history row failed; no complete logic summary is produced and
aggregate UI/static/E2E are not reached. The separate full static and browser
smoke passes above do not turn that aggregate into all-green or close ticket 01.
Integration verification details are recorded in
`/tmp/cadara-browserless-cli-enum-asset-merge-evidence.md`.

## Reviewed captured split-owner source integration (2026-10-12)

A new two-parent integration change preserves promoted revision `b8af3ce0` and
reviewed split source `ba953ebf`, including its preserved repair `9bd1b551`.
Standards review had zero findings; the Spec P2 incomplete-tessellation finding
is repaired and independently closed by the original reviewer. The source merge
is conflict-free; all 12 split source/spec paths exactly match the reviewed tip.
No public asset/stamp, recipe, CPP, binding, stage or source-producer workspace is
changed. The earlier browser qualification remains applicable to byte-identical
assets; no browser repeat or native rebuild is required for this source merge.

The split unique-owner gate is now certified from independently captured OWNER
winding, support and complete trim at the actual producer boundary, including
source-world normalization. The runtime tool's opposite winding in this capture
is not a SameOrientation default. Selection accepts only existing exact scoped
claims for the authored tool source and exactly one agreeing native face
occurrence. Missing/opposite/ambiguous/incomplete evidence fails closed; malformed
selected-face or unscoped source facets refuse authority. No unqualified alias,
output-order choice, tolerance relaxation or sibling voting is used. Continued
history probing preserves declared `sourceBodyScopeBinding` and the existing
exclusive `bodyOf` witness; multiple surviving bodies remain ambiguous.

The corrected original Split boundary had **0 noMatch / 10 unique / 3 ambiguous**
siblings, not the earlier wrong-boundary noMatch diagnosis. That correction alone
never authorized voting or weakened the all-sibling mapper; captured owner
occurrence evidence is the independent certification seam.

Ticket 01 remains blocked. The original 9841/JHo direct
`FcPi2PXMdBYVGkq_1:externalSketchReference:JHo` apply failure occurs before Split
and was independently reproduced using the old base and identical compiled
inputs after diagnostically continuing past its old review failure. No repair or
assertion weakening for that adjacent ambiguity is included. Tickets 02–38 are
not implemented by this merge. Next gate: diagnose and qualify that source/apply
anchor independently, then pass the unchanged original affected acceptance rows
and complete the required validation lanes before ticket 01 closure or advancing
the remaining browserless-CLI specification. Aggregate timeout is not all-green.

Fresh integrated qualification passes the exact four-file / 45 source
facet/witness/contract/probe checks, unchanged complete d3cd9 acceptance with its
original dimension/variable rebuild assertions, 77 native naming/history/query/
runtime/default-filesystem STEP checks, and all 49 static guards. Production
typecheck, normal spec ratchet and full lint pass. Exact exclusion-cleared typing
includes all five touched specs and matches reviewed `ba953ebf` with the same
promoted declarations: 75 existing diagnostics (55 apply / 20 kernel probe),
zero additions or removals; this is not a clean excluded-spec typecheck.

The required post-merge aggregate ran once and exits 124 at 300 seconds during
logic, after lint/build/spec typing completed. It reports the inherited 9841
Sketch 3/4 split-interface history row failed; no complete logic summary or
aggregate UI/static/E2E execution is claimed. Separate targeted/static passes
above do not close that remaining source/apply gate. Final revision and detailed
results are recorded in `/tmp/cadara-browserless-cli-final-gate-merge-evidence.md`.

## Explicit importer deferral and ticket 01 disposition (2026-10-12)

The user explicitly directed: **defer Onshape importer changes for later**.
This scope decision supersedes the preceding requirement to repair the JHo
importer anchor before CLI02 onward. Ticket 01 acceptance closure is **runtime
migration qualified; outstanding importer rows deferred**, not “all acceptance
green”. The parent owns tracker disposition and subsequent tickets.

The JHo source-provenance blocker is real: captured coordinates and canonical
within-sketch coincidence do not establish the opaque external reference's
source creator/owner/point identity. Investigation left its source workspace
clean; there is no source implementation to merge. No coordinate fallback,
synthetic provenance, relaxed matching, fake capability or weaker assertion is
authorized by this deferral. Exact original tests remain unchanged; no claim is
made that whole-importer acceptance passes.

The previously qualified native kernel, promoted JS/WASM/declarations, asset
stamp, browser/filesystem runtime and real sheet/solid STEP export remain
unchanged. No native build or repeat qualification is needed for this docs-only
disposition. The required aggregate is **not green**; the known importer failure
and bounded aggregate result remain visible rather than being waived into a
passing test result. Evidence and this disposition's fresh bounded aggregate
result: `/tmp/cadara-browserless-cli-importer-deferral-merge.md`.

