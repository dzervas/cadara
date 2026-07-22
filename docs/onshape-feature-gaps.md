# Onshape → Cadara Feature Gap Inventory

Snapshot 2026-07-18 (commit 06270237). What Onshape Part Studio features cadara
cannot represent, and where the blocker sits. Excludes sheet metal, surface
modelling, and FeatureScript custom features (permanently honest-bake).
Companion to `docs/onshape-importer-completion-plan.md` — that plan's scope is
table 3 only ("existing cadara capabilities"); tables 1–2 are out of scope
until cadara grows the substrate/executors.

Sources: `src/contracts/modeling/schema.ts` (`FeatureKind`,
`AuthoredFeatureKind`), `src/contracts/modeling/advanced-solid.ts`
(`AdvancedSolidFeatureKind`), OCC executor cases in
`src/domain/modeling/occ/features/`, and the onshape translator registry in
`src/domain/import/onshape/fidelity-planner.ts`.

## 1. Missing entirely in cadara (no feature kind)

Import behavior today: Wave-C honest-bake family reason codes from
`fallback-feature-translator.ts`.

| Onshape feature | Notes | Bake reason code |
|---|---|---|
| Curve pattern | No curve/path pattern executor or topology semantics | `pattern-unsupported` |
| Sketch/face/feature/table pattern variants | Linear/circular support is body-copy only. Feature-level sketch, face, feature-seed, and table-driven pattern variants are not modeled parametrically. | `pattern-type-unsupported` / `pattern-feature-seed-unsupported` |
| Skip-instance pattern variants | Body-copy patterns deliberately reject skipped instances to keep output identity/topology deterministic. | `pattern-skipping-unsupported` |
| Draft | No `draft` kind | `part-operation-unsupported` |
| Rib | No `rib` kind | `part-operation-unsupported` |
| Move face | No direct-editing family | `part-operation-unsupported` |
| Delete face | 〃 | `part-operation-unsupported` |
| Replace face | 〃 | `part-operation-unsupported` |
| Modify fillet | No re-fillet editing | `part-operation-unsupported` |
| Primitives (sphere, cube, cylinder) | No primitive kinds | `primitive-unsupported` |
| Derived / Import derived | No cross-document reference substrate | `part-operation-unsupported` |
| Curves (helix, projected, bridging, composite, intersection, trim, routing) | No curve feature family; also blocks sweep-along-helix | `curve-modeling-unsupported` |
| Mate connector / point / origin / tag | Annotation/meta; fine to leave as honest-bake | `annotation-meta-unsupported` |

## 2. Kind exists in cadara's contract but has no OCC executor

`AdvancedSolidFeatureKind` members with no case in
`src/domain/modeling/occ/features.ts` — the contract/forms/import plumbing can
carry them, the kernel cannot build them.

| Feature | Status |
|---|---|
| Face blend | In contract, no kernel case, no translator |
| Wrap | 〃 |
| Enclose | 〃 |
| External thread | 〃 |

## 3. Feature exists and executes, but narrower than Onshape

Split by where the gap actually sits.

### 3a. Cadara contract/kernel gap (needs contract or kernel work — out of plan scope)

| Feature | Missing vs Onshape |
|---|---|
| Transform | Rotation (only XYZ translation + plane-normal distance); copy mode |
| Chamfer | Two-distances and distance+angle styles. The authoring contract and OCC executor accept only one positive distance and execute equal offsets (`Add_3(distance, distance, ...)`); T.6 confirmed these forms require future contract/kernel work. |
| Shell | True closed-hollow shell with no removable/open faces (`isHollow=true`, empty `entities`) remains unsupported; non-hollow empty-selection offset-all-faces is now represented by `mode: "offsetAllFaces"`. |
| Hole | Supported executable subset: simple, counterbore, and countersink holes with sketch-point locations, explicit body scope, blind/through termination, and forward/reverse direction. Unsupported: threaded/tapped/clearance/standards holes, `UP_TO_NEXT` / `UP_TO_ENTITY`, ambiguous multi-sketch or multi-point location queries, and custom start planes or drill/tip geometry. |
| Linear pattern | Supported executable subset: Onshape `PART`/body seed copy with `operationType=NEW`, resolved seed bodies, one explicit direction, instance count, spacing, optional opposite direction, no second direction, no centered mode, and no skipped instances. Unsupported variants: sketch/face/feature/table/skip. |
| Circular pattern | Supported executable subset: Onshape `PART`/body seed copy with `operationType=NEW`, resolved seed bodies, explicit axis, instance count, angle/equal spacing, optional opposite direction, no centered mode, and no skipped instances. Unsupported variants: sketch/face/feature/table/skip. |

### 3b. Translator-only gap (cadara can already express it — in plan scope, Phase T)

| Feature | Cadara supports, translator doesn't exploit | Plan item |
|---|---|---|
| Extrude | `upToFace`/`upToNext`/`upToPart` extents (only bespoke `upToVertex` promotion exists), two-side mode, `draftAngle`, multi-body `booleanScope: targetBodies` | T.1 |
| Revolve | join/cut/intersect operations, two-direction/symmetric extents, axis from construction line in another sketch or datum axis; all failures collapsed into `revolve-axis-unresolved` | T.2 |
| Sweep | OCC executes region-profile + sketch-entity path; translator bakes unconditionally | T.3 |
| Loft | OCC executes multi-profile loft; translator bakes unconditionally | T.4 |
| Mirror / Transform | Contract accepts any construction plane / transform reference; translator only accepts canonical datum planes | T.5 |
| Thicken | OCC executes it, but needs durable face refs — gated on durable naming (Phase K/S), not a translator defect | K/S |
| Fillet / Chamfer / Shell | Fully translated + topology-resolved, plan-gated on `supportsDurableTopologyNaming === false` | K/S |

## 4. Cross-cutting import blockers (not per-feature)

- `OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming: false` — gates every
  edge/face consumer (fillet, chamfer, shell, thicken, sketch-on-face). Release
  blocker: upstream topology-changing sketch edit reports a deleted edge as
  live (`docs/architecture/onshape-topology-reference-resolution.md`).
- First-bake poisoning — one baked feature converts the entire downstream
  history into a single final-state mesh (plan Phase B fixes via rollback
  checkpoint segments).
- Capture has no per-feature B-rep — only geometric signatures
  (bbox/centroid/plane/cylinder/sphere/line/circle) and tessellation; STEP is
  archived but unconsumed (`reconstructMeshToBrep` unimplemented).
- Apply-time rematch failure silently falls back to the baked checkpoint with
  only a warning (`topology-apply-rematch-failed`) — review "parametric" is
  best-effort.
