# Design: Onshape Capture Bundle

## Context

Spike evidence (`tmp-onshape-spike/`, two documents, 51 features):

- Feature kinds observed: `extrude`, `newSketch`, `assignVariable`, `chamfer`, `transform`, `cPlane`, `shell`, `splitPart`, `booleanBodies`, `deleteBodies` — all covered by cadara's `AuthoredFeatureKind` plus document variables.
- Sketch entities observed: line segments, circles, one arc, points, construction flags — all covered by the sketch contract.
- Constraints observed: COINCIDENT, PROJECTED, MIDPOINT, HORIZONTAL, VERTICAL, DISTANCE, LENGTH, PARALLEL, PERPENDICULAR, DIAMETER, ANGLE, EQUAL — all with cadara `ConstraintDefinition` counterparts. MIRROR, LINEAR_PATTERN, and OFFSET are derivation relationships in Onshape's encoding (master entities → derived output entities); cadara's `SketchDerivationDefinition` covers `mirror`/`linearPattern` but has **no `offset` derivation kind** — OFFSET (16 instances, arbitrary curve chains with per-entity half-space sides, sometimes offsetting external/projected geometry) is a known contract gap addressed by the separate `add-sketch-offset-derivation` change; the provider change maps OFFSET onto that derivation once it lands, or degrades to non-associative entities at their captured solved positions until then. Capture is unaffected — the raw constraint records and solved geometry are archived either way.
- 139 opaque deterministic-ID references (`BTMIndividualQuery-138`, `BTMIndividualSketchRegionQuery-140`, `BTMIndividualCreatedByQuery-137`) across sketch planes, extrude profile regions, boolean scopes, and projected-constraint externals. These are Parasolid-kernel-minted identities meaningless outside Onshape; their geometric meaning must be dumped at capture time.

## Decision 1: Bundle enters the app as a plain file

The bundle is imported through the existing `import-provider-contract` local-file path (`ResolvedImportSource` with bytes + fingerprint). No orchestrator, URL, or cloud-object work is needed now, and the eventual OAuth/proxy transport swaps the fetcher without touching the format or translator.

- Extension: `.onshape-capture.json` (uncompressed JSON; gzip variant deferred until bundle sizes prove it necessary — spike documents serialize to ~25 MB, dominated by pretty-printing and tessellation, both controllable).
- Alternative rejected: live URL import in the browser — blocked on secrets/CORS, and would couple the provider to network availability.

## Decision 2: Verbatim archival, versioned envelope

The bundle stores raw Onshape API responses untouched under a thin envelope:

```
{
  formatVersion: 1,
  provenance: { capturedAt, cliVersion, apiVersion, baseUrl,
                documentId, wvm, wvmId, microversion },
  document: <raw response>,
  elements: <raw response>,
  partStudios: [{
    elementId, name,
    features: <raw getFeatures response>,        // ordered history, sketches inline
    sketches: <raw getSketches response>,        // solved sketch geometry (solver oracle)
    parts: <raw parts response>,
    featureSpecs: <raw featurespecs response>,
    resolvedReferences: [ ... ],                 // Decision 4
    groundTruth: { ... },                        // Decision 5
    rollbackSnapshots: null                      // reserved, v1 does not populate
  }]
}
```

Rationale: the translator will improve for years; captures must not decay with it. Typia validates the envelope and provenance strictly but treats raw Onshape payloads as opaque `unknown` at the bundle boundary — interpreting them is the provider's job, with its own narrower validators. `microversion` pins exactly what was captured and enables future refresh/re-import binding.

## Decision 3: CLI shape — subcommand architecture

The CLI is the general-purpose `cadara` tool; Onshape capture is its first subcommand, not its identity. More subcommands (other importers, headless export, document utilities) will land later.

- Entrypoint: `src/cli/main.ts` — a hand-rolled dispatcher (no argument-parsing dependency) mapping `cadara <group> <command>` to command modules. Each command module exports `{ name, description, run(argv, env, io) }`; the dispatcher owns usage/help output and the exit-code policy (0 success, 1 command failure, 2 usage error).
- Command location: `src/cli/commands/onshape-capture/` implementing `cadara onshape capture <url> [out]`. Onshape-specific REST client and bundle assembly stay inside the command directory; anything reusable by the app (the bundle contract) lives in `src/contracts/import/`.
- Wiring: `src/cli/package.json` exposes the `cadara` bin; root script alias `bun run cli -- onshape capture <url> [out]`.
- Boundary rule: subcommands consume `src/contracts/` and `src/domain/` code directly (same monorepo, same Typia toolchain) but never import from `src/components/`, `src/workbench/`, or anything browser-bound.
- Auth: `ONSHAPE_ACCESS_KEY` / `ONSHAPE_SECRET_KEY` env vars → HTTP Basic. Keys never logged, never persisted, never embedded in output.
- Input: full Onshape browser URL (`/documents/{did}/{w|v|m}/{id}[/e/{eid}]`). Without `/e/`, all Part Studios in the workspace/version are captured into one bundle.
- Transport: injected `fetch` so tests run against recorded fixtures; retry with exponential backoff on 429/5xx; bounded concurrency (default 2 in-flight requests).
- Failure policy: any missing mandatory section aborts the capture with a non-zero exit and no output file. No partial bundles, no silently skipped sections (AGENTS: never silence exceptions). Optional sections (`featureSpecs`) may be absent but the absence is recorded explicitly.

## Decision 4: Deterministic-ID resolution table

For every deterministic ID referenced anywhere in the captured feature list, the CLI evaluates a FeatureScript snippet via `POST /partstudios/.../featurescript` that queries the entity and returns a geometric signature:

- entity class (face/edge/vertex/body) and geometry type (plane, cylinder, line, circle, ...),
- defining data where cheap (plane origin+normal, cylinder axis+radius, edge endpoints/midpoint),
- bounding box and centroid,
- a small tessellation sample for ambiguous cases,
- the owning feature id when derivable (`CREATION` history).

Stored as `resolvedReferences: [{ deterministicId, signature, evaluatedAt: "finalState" }]`.

Known limitation (stated, not hidden): signatures are evaluated against the final model state. An entity consumed mid-history and later destroyed (e.g. a face removed by a subsequent cut) may fail to resolve; such IDs are recorded with a structured `unresolved` reason so the provider can degrade that feature to baked geometry instead of guessing. Per-history-point evaluation requires rollback mutation and is deferred with the `rollbackSnapshots` reservation.

## Decision 5: Final-state ground truth

The bundle includes the final Part Studio geometry for provider-side validation and baked-geometry fallback:

- tessellated faces (`GET .../tessellatedfaces` or equivalent) with modest chord tolerance, and
- a STEP export via the translation API (text, embedded as a string).

This lets the future provider (a) verify its OCCT rebuild against Onshape's result and (b) fall back to importing real geometry when a feature cannot be translated — without a network connection.

## Decision 6: Testing (per docs/testing.md)

Lane: **logic**. Seams: subcommand dispatch (routing, usage errors, exit codes), URL parsing, bundle assembly against injected-fetch fixture transcripts, envelope schema validation, failure policy (abort on missing mandatory section, backoff on 429). All `bun:test` `.spec.ts` next to the code; fixture transcripts are pruned spike captures checked into the repo. No UI or e2e lanes: the CLI has no browser surface, and network integration against live Onshape stays a manual smoke documented in the CLI README, not CI.

## Risks

- Onshape API schema drift (`BTM*-###` version suffixes): mitigated by pinning `apiVersion` in provenance and archiving verbatim payloads; the provider validates narrowly and reports unknown shapes as diagnostics.
- FeatureScript-eval resolution may be slower than expected on large models (one call per deterministic ID batch): mitigate by batching IDs per evaluation call.
- Bundle size growth from tessellation/STEP: mitigate with compact JSON (no pretty-print) and coarse default tolerance; gzip variant is a backwards-compatible follow-up (`formatVersion` gate).
