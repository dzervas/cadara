## Context

Reference-image calibration currently stores anchors and distance constraints inside operation-local calibration state, then runs a dedicated calibration solver to update image placement. That design keeps image calibration isolated from the normal sketch constraint workflow, but it creates two major problems:

- users cannot use ordinary sketch constraints and dimensions to drive calibration anchors;
- the editor must maintain a second solve boundary with weaker guarantees and a different failure model.

The redesign inverts that relationship. Calibration mode remains the workflow that places and manages image anchors, but the anchor points themselves become ordinary sketch-owned construction points in the flat graph. The reference-image operation continues to own image payload and anchor metadata, including the image-space `u/v` coordinates for each anchor and the durable binding to a local sketch point id. The normal sketch solver then determines the solved anchor positions, and the image system derives placement from those solved points after the sketch solve completes.

This is a cross-cutting change because it touches the reference-image operation contract, special-mode authoring, sketch mutation flows, replay/history, solve-to-render data flow, and compatibility with documents that already contain operation-local calibration data.

It also supersedes two synced main-spec capabilities introduced by the archived calibration-mode change:

- `reference-image-calibration`, which currently assumes a dedicated calibration solver and operation-local calibration constraints;
- `reference-image-anchor-reference-points`, which currently assumes calibrated anchors export as fixed projected references into the main sketch.

## Goals / Non-Goals

**Goals:**
- Allow reference-image anchors to be constrained and dimensioned using the normal sketch constraint workflow.
- Reduce the dedicated calibration solver to a placement-fit and validation step instead of a separate constraint solver.
- Keep anchors locked to image-relative `u/v` locations so image placement remains recoverable from solved sketch points.
- Preserve stable failure behavior: weak or contradictory anchor fits must surface diagnostics and keep the last stable placement.
- Keep reference-image editing separate from presentational components and preserve the operation-owned/document-owned boundary.

**Non-Goals:**
- Add new general-purpose sketch constraints solely for calibration.
- Make imported images author local sketch geometry at import time.
- Solve arbitrary non-affine image warps; the image remains a placement-driven rectangle with rotation and either locked-aspect or independent scaling.
- Remove special editor modes entirely; calibration still needs a dedicated anchor-placement/management workflow.

## Decisions

### Decision: Reference-image anchors become bound sketch points, not operation-local solved anchors

The system will represent each calibration anchor as:

- operation-owned metadata: `anchorId`, label, image-space `uv`, and bound `pointId`;
- sketch-owned geometry: a local construction point in the flat sketch graph referenced by `pointId`.

Rationale:
- This lets existing constraints, dimensions, undo/redo, deletion cleanup, and solve feedback work unchanged on the anchor points.
- The operation retains the minimum metadata required to reconstruct image placement and keep the anchor tied to a stable pixel-relative location.

Alternatives considered:
- Keep operation-local anchors and mirror them into temporary sketch points.
  Rejected because it preserves two sources of truth and reintroduces synchronization bugs.
- Introduce a dedicated `pointOnReferenceImage` constraint in the sketch solver.
  Rejected because it still creates image-specific solving semantics when simple point bindings plus post-solve fitting are enough.

### Decision: Calibration mode only authors and manages bindings

Reference-image calibration mode will:

- place bound construction points from clicks on the image underlay;
- persist the clicked `uv` plus the newly created or selected `pointId`;
- allow anchor selection, relabeling, rebinding, and removal;
- commit back to ordinary sketch editing once placement is complete.

It will not author calibration-only distance constraints or run a dedicated constraint workflow.

Rationale:
- The user asked for the normal sketch workflow to own constraints.
- Keeping calibration mode focused on placement and binding avoids re-creating a shadow constraint editor inside a special mode.

Alternatives considered:
- Keep calibration mode open while also exposing the full constraint toolbar inside it.
  Rejected because it blurs ownership and duplicates normal sketch editing inside a special case.

### Decision: Image placement is derived after sketch solve from bound point positions and stored `u/v`

After the sketch solver produces solved point positions, the reference-image system will recover placement from the set of bound anchors:

- `lockedAspect`: solve a similarity transform from `u/v` to solved point positions;
- `independent`: solve a rotated non-uniform scale transform from `u/v` to solved point positions.

The fit step is a deterministic recovery/validation pass, not an iterative multi-constraint editor in its own right.

Rationale:
- The sketch solver already resolves the anchor geometry; the image system only needs to infer the best placement consistent with those results.
- This preserves the current rendering model of a rectangular image underlay.

Alternatives considered:
- Convert the image into four solver-owned corner points and constrain those directly.
  Rejected because it leaks image internals into the sketch graph, complicates selection/rendering, and makes the image feel like ordinary geometry rather than an underlay.

### Decision: Remove projected fixed-anchor exports rather than layering them on top of bound points

Once anchors become ordinary sketch-owned construction points, a second projected-reference representation for the same anchors becomes redundant and harmful. The redesign will remove fixed projected anchor exports and treat the bound local points as the only constraint/edit targets.

Rationale:
- Keeping both representations would duplicate anchor identity and create conflicting editing semantics.
- The user explicitly wants anchors solved through the normal sketch workflow, which means the local point is the authoritative object.

Alternatives considered:
- Keep projected anchor exports for snapping only while also exposing local bound points.
  Rejected because it preserves duplicate anchor handles and makes selection/visibility harder to reason about.

### Decision: The last stable placement remains the committed fallback

If the solved anchor set is insufficient, contradictory, or numerically invalid for the requested scale mode, the operation will:

- surface diagnostics on the reference-image operation and bound anchors;
- keep the previously stable placement for rendering and persistence;
- avoid exporting synthetic fixed reference geometry derived from the failed fit.

Rationale:
- A failed fit should never collapse the image or silently mutate the document into a bad state.
- This matches the safety direction already established in the recent calibration fixes.

Alternatives considered:
- Always update the image with the best-effort fit even when residuals are poor.
  Rejected because it hides failure and makes downstream sketch references untrustworthy.

### Decision: Existing operation-local calibration data migrates to bound sketch points

Compatibility will be handled by migrating legacy calibration state on load or edit replay:

- each legacy calibration anchor becomes a construction point in the flat sketch graph;
- each new point is initialized from the legacy anchor target position when available, otherwise from the solved placement projection;
- legacy calibration-only constraints are discarded and become diagnostics or migration notes if they cannot be represented in the flat graph.

Rationale:
- The new architecture cannot faithfully preserve hidden calibration distance constraints because they are intentionally being removed.
- Migrating to explicit points preserves most user intent while moving documents onto the durable model.

Alternatives considered:
- Support both legacy and new calibration systems indefinitely.
  Rejected because it leaves two incompatible editing models in active code.

## Risks / Trade-offs

- [Sketch clutter from calibration anchors] → Mark bound anchor points as construction geometry by default, provide clear labels, and keep calibration-mode selection affordances for anchor management.
- [Legacy migration loses calibration-only distance constraints] → Surface migration diagnostics and preserve last stable placement so users can reapply intent with normal sketch dimensions if needed.
- [Anchor deletion can orphan image bindings] → Treat bound point deletion as anchor deletion, clean the binding from operation state, and surface mode/panel feedback when an operation loses required anchors.
- [Derived placement may lag behind generic sketch edits] → Recompute image placement as part of normal sketch solve/render refresh so image updates track any solve that moves bound points.
- [Ambiguous fit rules become harder to explain] → Keep diagnostics explicit around missing anchors, insufficient axis coverage, and residual mismatch; do not silently degrade to arbitrary placements.

## Migration Plan

1. Extend the reference-image operation schema to store anchor bindings to sketch point ids instead of operation-local solved anchor positions and calibration-only constraints.
2. Update calibration mode to place and manage construction points plus anchor metadata bindings.
3. Add post-solve placement recovery from bound point positions and wire it into sketch-session display/commit flows.
4. Remove the dedicated calibration constraint authoring path and fixed projected anchor-reference export behavior tied to calibration-local solves.
5. Migrate legacy documents by materializing bound construction points from stored calibration anchors and dropping legacy calibration constraints with diagnostics.
6. Rollback strategy: retain the legacy reader long enough to support downgrade/recovery during development, but write only the new binding model once the change ships.

## Open Questions

- Should calibration mode create fresh construction points only, or also allow binding an anchor to an already selected existing sketch point?
- Should bound anchor points remain visible outside calibration mode by default, or should the UI offer a dedicated visibility toggle for image anchor construction geometry after the projected-reference visibility path is removed?
- How aggressively should migration preserve legacy anchor labels and ordering when the underlying point ids are regenerated?
- Do we want a dedicated panel action to “re-enter calibration” for rebinding anchors without exposing point-management details in the generic sketch UI?
