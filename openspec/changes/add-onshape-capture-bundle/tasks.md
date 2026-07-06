## 1. Bundle Contract

- [ ] 1.1 Define `OnshapeCaptureBundle` envelope types in `src/contracts/import/onshape-capture-bundle.ts` (formatVersion, provenance, part-studio sections, resolved-reference table, ground truth, reserved `rollbackSnapshots`).
- [ ] 1.2 Add Typia runtime validators for the envelope and a `.spec.ts` exercising accept/reject cases (logic lane, per `docs/testing.md`).
- [ ] 1.3 Prune the spike captures into checked-in fixture transcripts (feature list, sketches, parts, featurespecs responses) with proprietary content reviewed.

## 2. CLI Shell

- [ ] 2.1 Implement `src/cli/main.ts` subcommand dispatcher (registration table, usage/help, exit codes 0/1/2) with injected env and IO.
- [ ] 2.2 Wire the `cadara` bin in `src/cli/package.json` and a root `package.json` script alias.
- [ ] 2.3 Add dispatcher `.spec.ts` coverage: routing, unknown command usage error, failing command exit path.
- [ ] 2.4 Enforce the no-browser-imports boundary for `src/cli/**` via lint config or a static test.

## 3. Onshape Capture Subcommand

- [ ] 3.1 Implement the Onshape REST client: Basic auth from env, injected fetch, bounded concurrency, exponential backoff on 429/5xx, credential-free error formatting.
- [ ] 3.2 Implement document URL parsing (`/documents/{did}/{w|v|m}/{id}[/e/{eid}]`) with usage errors before any network call.
- [ ] 3.3 Implement capture of mandatory and optional sections per Part Studio (features, sketches, parts, featurespecs) with verbatim archival.
- [ ] 3.4 Implement deterministic-ID collection from feature parameters, sketch-plane queries, region queries, and constraint externals.
- [ ] 3.5 Implement FeatureScript-eval resolution of collected IDs into geometric signatures, batched per Part Studio, with structured `unresolved` records.
- [ ] 3.6 Implement final-state ground truth capture (tessellated faces + STEP text) with recorded tolerance.
- [ ] 3.7 Implement bundle assembly, envelope validation before write, and the no-partial-output failure policy.
- [ ] 3.8 Add `.spec.ts` coverage against fixture transcripts: full capture happy path, element-scoped capture, missing mandatory section abort, optional-section absence, 429 backoff, unresolved reference record.

## 4. Cleanup and Verification

- [ ] 4.1 Delete `scripts/onshape-spike.ts`.
- [ ] 4.2 Write `src/cli/README.md`: usage, credential setup, manual live-smoke procedure (not CI).
- [ ] 4.3 Manual smoke: capture both spike documents through the CLI, validate the bundles against the envelope schema, and record resulting bundle sizes in the change notes.
- [ ] 4.4 Run `bun run test:all`.
