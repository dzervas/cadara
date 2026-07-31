# Onshape capture API budget

This audit is scoped to the five source captures represented by the curated
fixtures in `test/fixtures/onshape-captures`:
`405fa226bb150016d09afc09`, `40a51fb8fa82fd4565151114`,
`5151a4c877c9493b733ad52f`, `9841e486906fa2ce62d74d8e`, and
`d3cd9b09c3c36af1dd2efae9`.

The baseline counts were derived from capture control flow and local bundles
without live requests. Targeted enrichment was later verified against the live
browser-authenticated API. A translation-status poll is listed separately because
an export can complete in its initial response or require up to the configured
poll budget.

## Baseline at commit 305aee75

The five bundles contain **85** rollback snapshots: **13 / 8 / 21 / 28 / 15**.
A complete recapture with the former `--rollback-snapshots` mode makes **612 fixed successful
requests plus status polls for 95 STEP translations**. With one successful poll
per translation, that is **707 successful calls**.

| Endpoint purpose | Fixed calls | Why it was requested |
|---|---:|---|
| Document, elements, current microversion | 15 | Three metadata requests per root. |
| Temporary workspace create/delete | 10 | One lifecycle per root, even before knowing whether rollback geometry was useful. |
| Features, sketches, parts, feature specs | 40 | Four source responses for each of ten Part Studios. |
| Final deterministic-ID FeatureScript | 10 | One batched entity enumeration per studio. |
| Historical deterministic-ID rollback + FeatureScript | 122 | A workspace mutation and evaluation at each of 61 required states. |
| ID-less `qCompressed` FeatureScript | 7 | Separate history-point query-resolution passes. |
| Solid-extrude profile FeatureScript | 38 | One pass per distinct extrude rollback state, including readable `qSketchRegion`. |
| Final tessellation, translation start, STEP download | 30 | Three fixed calls for every studio with bodies. |
| Rollback, tessellation, translation start, STEP download | 340 | Four fixed calls for every one of 85 blind snapshots. |
| Translation-status polls | variable | 95 translation jobs, 0–120 polls each. |

Per bundle, the baseline fixed and one-poll totals are:

| Bundle | Fixed | One poll/export |
|---|---:|---:|
| 405 | 116 | 129 |
| Mounts | 56 | 65 |
| 5151 | 135 | 157 |
| 9841 | 204 | 233 |
| d3cd9 | 101 | 123 |
| **Total** | **612** | **707** |

HTTP retries add wire attempts. They do not change these logical successful-call
counts.

## Evidence classification

Evidence required for exact parametric import:

- source features and solved sketches pinned to one immutable microversion;
- final-state deterministic-ID evidence plus one consumer-scoped history-point
  record for every authored topology reference, because surviving IDs can have
  different geometry or ownership at the consumer point; and ID-less
  compressed-query evidence when an authored topology reference cannot be
  represented directly;
- targeted pre-consumer evaluation of opaque `qCompressed` extrude profiles;
- exact local region-set semantics for readable `qSketchRegion` assignments;
- STEP/tessellation only for a proven baked checkpoint boundary.

Evidence that was only a planning shortcut:

- every-feature rollback snapshots;
- final STEP/tessellation when no final bake boundary consumes it;
- workspace rollback mutations before read-only FeatureScript evaluations;
- separate deterministic/query/profile evaluations at the same rollback index;
- server face witnesses for readable `qSketchRegion` region sets.

The exact opaque profile-state counts are **1 / 0 / 7 / 9 / 1**. Mounts has no
opaque extrude profile. The only currently proven intrinsic geometry boundaries
are the genuine `bodyType=SURFACE` `Extrude 4` features in 9841 and d3cd9.

## Optimized flow

1. Read source responses from `m/{microversion}`.
2. Represent exact readable `qSketchRegion` assignments locally as versioned
   region-set evidence. Unsupported syntax remains explicitly unresolved.
3. Evaluate opaque `qCompressed` only on the server. Never decode its payload
   locally.
4. Batch every deterministic-ID consumer, ID-less compressed queries, and opaque
   profiles into one read-only FeatureScript request per required rollback
   index.
5. Cache only immutable FeatureScript responses. The key includes evidence
   schema version, API/base identity, document, microversion, element, rollback
   index, and exact script fingerprint. Workspace, rollback, and translation
   mutations are never cached.
6. Create one lazy temporary workspace only when a proven geometry boundary
   exists. Capture one tessellation/STEP chain per such boundary.
7. Enrich an existing validated bundle by replacing stale deterministic
   consumer-history, ID-less query-history, and profile evidence against the
   captured microversion only. Versioned manifests prove deterministic/query
   and profile completeness independently. Old or incomplete evidence is a
   cache miss, not an importer compatibility path.

## Optimized call budget

With API-key authentication, a fresh equivalent capture with targeted boundary
snapshots uses **184 fixed calls plus status polls for two surface-boundary STEP
exports**. This adds 36 distinct immutable history states from deterministic-ID
consumers that survive final state, counted from the local root bundles: **23 /
0 / 3 / 4 / 6** for 405 / Mounts / 5151 / 9841 / d3cd9:

| Bundle | Fixed | With one boundary poll |
|---|---:|---:|
| 405 | 57 | 57 |
| Mounts | 13 | 13 |
| 5151 | 28 | 28 |
| 9841 | 52 | 53 |
| d3cd9 | 34 | 35 |
| **Total** | **184** | **186** |

Targeted enrichment of the existing bundles makes one immutable FeatureScript
request per distinct rollback state that has a deterministic-ID consumer, a
supported ID-less compressed query, or an opaque profile query. Existing valid
final-state deterministic records are retained, so no final-state evaluation is
needed:

| 405 | Mounts | 5151 | 9841 | d3cd9 | Total |
|---:|---:|---:|---:|---:|---:|
| 24 | 5 | 20 | 38 | 20 | **107** |

Cookie authentication lazily adds one successful `/api/clientinfo/xsrf`
bootstrap per CLI process that performs a POST or DELETE. Therefore five separate
fresh cookie-authenticated captures cost **189 fixed / 191 with one boundary
poll**, while separate targeted enrichments cost
**25 / 6 / 21 / 39 / 21 = 112** successful calls. A repeated current-schema
and current-manifest enrichment makes no request, so it does not bootstrap XSRF.

Readable region sets and unsupported query syntax remain local evidence; raw
features, sketches, parts, feature specs, final geometry, rollback snapshots,
and provenance are never recaptured or changed by enrichment. No recapture was
performed for this audit.
