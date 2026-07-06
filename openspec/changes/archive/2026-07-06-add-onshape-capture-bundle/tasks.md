## 1. Bundle Contract

- [x] 1.1 Define `OnshapeCaptureBundle` envelope types in `src/contracts/import/onshape-capture-bundle.ts` (formatVersion, provenance, part-studio sections, resolved-reference table, ground truth, reserved `rollbackSnapshots`).
- [x] 1.2 Add Typia runtime validators for the envelope and a `.spec.ts` exercising accept/reject cases (logic lane, per `docs/testing.md`).
- [x] 1.3 Prune the spike captures into checked-in fixture transcripts (feature list, sketches, parts, featurespecs responses) with proprietary content reviewed.

## 2. CLI Shell

- [x] 2.1 Implement `src/cli/main.ts` subcommand dispatcher (registration table, usage/help, exit codes 0/1/2) with injected env and IO.
- [x] 2.2 Wire the `cadara` bin in `src/cli/package.json` and a root `package.json` script alias.
- [x] 2.3 Add dispatcher `.spec.ts` coverage: routing, unknown command usage error, failing command exit path.
- [x] 2.4 Enforce the no-browser-imports boundary for `src/cli/**` via lint config or a static test.

## 3. Onshape Capture Subcommand

- [x] 3.1 Implement the Onshape REST client: Basic auth from env, injected fetch, bounded concurrency, exponential backoff on 429/5xx, credential-free error formatting.
- [x] 3.2 Implement document URL parsing (`/documents/{did}/{w|v|m}/{id}[/e/{eid}]`) with usage errors before any network call.
- [x] 3.3 Implement capture of mandatory and optional sections per Part Studio (features, sketches, parts, featurespecs) with verbatim archival.
- [x] 3.4 Implement deterministic-ID collection from feature parameters, sketch-plane queries, region queries, and constraint externals.
- [x] 3.5 Implement FeatureScript-eval resolution of collected IDs into geometric signatures, batched per Part Studio, with structured `unresolved` records.
- [x] 3.6 Implement final-state ground truth capture (tessellated faces + STEP text) with recorded tolerance.
- [x] 3.7 Implement bundle assembly, envelope validation before write, and the no-partial-output failure policy.
- [x] 3.8 Add `.spec.ts` coverage against fixture transcripts: full capture happy path, element-scoped capture, missing mandatory section abort, optional-section absence, 429 backoff, unresolved reference record.

## 4. Cleanup and Verification

- [x] 4.1 Delete `scripts/onshape-spike.ts`.
- [x] 4.2 Write `src/cli/README.md`: usage, credential setup, manual live-smoke procedure (not CI).
- [x] 4.3 Manual smoke: capture both spike documents through the CLI, validate the bundles against the envelope schema, and record resulting bundle sizes in the change notes.
- [ ] 4.4 Run `bun run test:all`.

### Manual smoke results (4.3)

Both spike documents captured live through `cadara onshape capture` and validated against the `formatVersion: 1` envelope (the CLI validates before writing, so a written file is a passing validation):

| Document | Part Studio | Deterministic refs | Resolved | Unresolved | STEP chars | Bundle size |
| --- | --- | --- | --- | --- | --- | --- |
| `40a51fb8fa82fd4565151114` | Mounts | 11 | 5 | 6 | 16,809 | 9.1 MB |
| `9841e486906fa2ce62d74d8e` | Part Studio 1 | 223 | 133 | 90 | 332,546 | 24 MB |

Notes:
- Deterministic-ID resolution uses a per-Part-Studio FeatureScript eval (`qEverything` + `transientQueriesToStrings`, final state / `rollbackBarIndex=-1`) that returns native FS records decoded from the `BTFSValue` tree. Unresolved ids are edges/faces consumed mid-history (chamfer/transform), the documented Onshape limitation — recorded as explicit `unresolved` records, never fabricated.
- Signatures carry `entityClass`, `geometryType`, `boundingBox`, `centroid`, and cheap `definingData`: plane → origin/normal, cylinder → axis/axisOrigin/radius, circle → axis/center/radius, line → origin/direction. Live resolved-type distribution across the two documents: plane 99, line 25, circle 9, cylinder 2, plus bodies (`unknown`).
- Captured bundles are git-ignored (`*.onshape-capture.json`) as user-owned files that may contain proprietary geometry.
