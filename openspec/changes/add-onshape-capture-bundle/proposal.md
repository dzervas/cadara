# Add Onshape Capture Bundle

## Why

Onshape is the only mainstream parametric CAD whose full design definition — ordered feature history, sketch entities, sketch constraints, variables, and feature parameters — is available as structured JSON through its REST API. A spike capture of two real documents (`tmp-onshape-spike/`, 51 features total) confirmed that every feature kind present maps to an existing cadara `AuthoredFeatureKind` and every sketch constraint maps to an existing `ConstraintDefinition` kind. Importing Onshape models with history intact is therefore achievable and directly serves the "interop is identity" product principle.

The browser app cannot talk to Onshape directly: API keys are secrets that must not live in a web client, and the API does not serve arbitrary origins. Splitting the problem at the auth boundary keeps the browser clean: a CLI captures everything needed from Onshape into a single self-contained bundle file, and a future file-based import provider translates that bundle inside the app through the existing `import-provider-contract` pipeline. When OAuth/proxy transport arrives later, only the fetcher changes; the bundle format and translator do not.

Capture must be exhaustive because the import provider runs offline: topological references in feature parameters and projected sketch constraints are opaque deterministic IDs (139 instances across the spike documents) that are only resolvable while talking to Onshape. Their geometric meaning has to be dumped at capture time or it is lost.

## What Changes

- Add a versioned **Onshape capture bundle** file format: a single JSON document containing verbatim Onshape API responses (document metadata, element list, per-Part-Studio feature list, solved sketch states, parts, feature specs), a geometric resolution table for every referenced deterministic ID, final-state ground-truth geometry, and capture provenance.
- Establish the **cadara CLI** (`src/cli/`, Bun, no browser runtime) as a subcommand-based tool, and add its first subcommand: `cadara onshape capture <url>`, which authenticates with Onshape API keys from environment variables, accepts document URLs, and writes capture bundles. The subcommand dispatcher is deliberately minimal — future subcommands (other importers, headless export, document tooling) plug in without restructuring.
- Add Typia-validated contract types for the bundle envelope under `src/contracts/import/` so the capture CLI and the future import provider share one runtime-validated schema.
- Replace the spike script `scripts/onshape-spike.ts` with the CLI.

Explicitly out of scope (follow-up change `add-onshape-import-provider`): the `ImportProvider` that translates a bundle into an authored model document, feature/constraint mapping, deterministic-ID-to-OCCT geometry matching, and baked-geometry fallback.

## Capabilities

### New Capabilities

- `onshape-capture-bundle`: Defines the bundle file format, capture completeness guarantees, deterministic-ID geometry resolution, provenance, and the capture subcommand behavior (authentication, document resolution, failure policy, rate-limit handling).
- `cadara-cli-shell`: Defines the CLI entrypoint contract — subcommand registration and dispatch, argument/usage conventions, exit-code policy, and the rule that subcommands share domain/contract code with the app rather than duplicating it.

### Modified Capabilities

None. `import-provider-contract` is intentionally untouched; the bundle is designed to enter the app as an ordinary local file so the follow-up provider change needs no orchestrator modifications.

## Impact

- Affected code: new `src/cli/main.ts` (subcommand dispatcher), new `src/cli/commands/onshape-capture/` (Onshape REST client, bundle assembler), new `src/contracts/import/onshape-capture-bundle.ts` (+ runtime schema spec), `src/cli/package.json` (`cadara` bin entry), root `package.json` (script alias), removal of `scripts/onshape-spike.ts`.
- Affected APIs/contracts: adds a new contract module; no existing contract changes. The bundle format is the load-bearing interface between this change and the follow-up provider change.
- Dependency impact: none expected — Bun's built-in `fetch`, `node:fs`, and `node:zlib` suffice; Typia is already the validation toolchain.
- Security impact: API keys are read from `ONSHAPE_ACCESS_KEY`/`ONSHAPE_SECRET_KEY` only, never written to disk, never embedded in bundles. Bundles may contain proprietary geometry; they are user-owned files like any other CAD export.
- Testing impact: logic-lane `bun:test` coverage for URL parsing, bundle assembly, schema validation, and failure policy using recorded fixture responses (injected fetch); no UI or e2e lanes involved. Spike captures become fixtures.
- Rate/ToS impact: capture is read-only against documents the key owner can access; the CLI backs off on HTTP 429 and caps request concurrency.

## Assumptions and Open Questions

- **Assumption:** Onshape API keys remain usable via HTTP Basic auth against `https://cad.onshape.com/api/v10`. Verified during the spike.
- **Assumption:** the FeatureScript evaluation endpoint (`POST /partstudios/.../featurescript`) can resolve deterministic IDs to geometric signatures at a given microversion without mutating the workspace. If per-history-point resolution proves to require rollback-bar mutation, resolution will be captured against the final state only and the limitation recorded in the bundle (see design.md, Decision 4).
- **Open question:** per-feature rollback B-rep snapshots (for validating intermediate rebuild states in the future provider) require moving the rollback bar, which mutates the workspace. Deferred behind an explicit opt-in flag and a temporary API-created branch; the bundle format reserves a field for it but v1 of the CLI does not implement it.
- **Interpretation chosen:** capture is archival, not translational — raw API responses are stored verbatim and all interpretation happens in the provider. The alternative (translate at capture time into cadara document form) was rejected: it would duplicate contract knowledge outside the app, make bundles unreproducible as the translator improves, and turn every translator bug into a re-capture.
