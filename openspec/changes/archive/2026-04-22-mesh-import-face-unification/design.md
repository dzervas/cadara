## Context

Mesh imports (STL/3MF) currently go through: parse triangles → analyze topology → classify (analytic/faceted/rejected) → bake to JSON → restore via `StlAPI.Read` → `BRepBuilderAPI_MakeSolid`. The resulting OCC solid retains one triangular planar face per source triangle. A 10k-triangle mesh produces a 10k-face solid where every face is a tiny triangle — unusable for face selection or downstream operations.

Meanwhile, STEP imports produce solids with proper analytical faces (planes, cylinders, etc.) because the B-Rep is transferred directly. The `ShapeUpgrade_UnifySameDomain` pass is already used after boolean operations (`refineBooleanResultShape` at features.ts:222) to merge faces sharing the same underlying surface, but it is never applied to mesh-imported solids.

Additionally, faceted fallback meshes have `seedNaming: false` (features.ts:788), which means their faces never receive durable `FaceId` references — making them invisible to face-picking even if the faces were unified.

## Goals / Non-Goals

**Goals:**
- Recover coplanar faces from mesh-imported solids using OCC's built-in surface domain unification
- Recover simple full-cylinder mesh imports as analytical OCC cylinders when the mesh has one cylindrical side band and two planar caps within tolerance
- Enable face selection for all mesh-imported solids, including faceted fallback
- Record unification metrics in provenance for quality visibility
- Allow tolerance tuning for noisy meshes

**Non-Goals:**
- NURBS surface fitting from point clouds (requires segmentation algorithms not in OCC's unifier)
- Automatic hole filling or manifold repair for broken meshes
- Curved surface approximation beyond what `UnifySameDomain` can recognize
- UI changes to the mesh import dialog or quality review flow

## Decisions

### Decision 1: Reuse `ShapeUpgrade_UnifySameDomain` rather than custom surface fitting

**Choice:** Call the existing `refineBooleanResultShape`-style unification on mesh solids.

**Alternatives considered:**
- **Custom region-growing + NURBS fit per cluster**: Higher quality for freeform surfaces, but requires mesh segmentation, boundary extraction, and `GeomAPI_PointsToBSplineSurface` per region. Significantly more complex and brittle.
- **`BRepBuilderAPI_Sewing` with higher tolerance**: Sewing re-stitches edges but does not merge faces by surface type. Would not recover analytical faces.

**Rationale:** `UnifySameDomain` is battle-tested in this codebase, handles the most common analytical surfaces, and requires ~10 lines of new code. It's the right first step; custom fitting can be layered later for freeform surfaces.

### Decision 2: Use relaxed tolerances for mesh unification vs boolean unification

**Choice:** Default mesh unification tolerances at `linearTolerance: 0.01` and `angularTolerance: 0.01` (vs 0.001/0.001 for booleans).

**Rationale:** Mesh triangulation introduces discretization error larger than boolean floating-point error. Tighter tolerances would fail to merge faces that genuinely belong to the same surface. The tolerance is configurable per-import for edge cases.

### Decision 3: Keep faceted fallback naming lightweight

**Choice:** Set `seedNaming: true` for recovered analytical mesh imports, but keep `seedNaming: false` for faceted fallback imports.

**Rationale:** Faceted fallback solids still need topology IDs for selection and reference resolution, but OCC selector-name seeding is too expensive on raw triangle meshes with thousands of faces, edges, and vertices. The render path continues to use the baked mesh asset, and deterministic restored BRep ordering provides lightweight IDs without generating thousands of selector labels during import commit.

### Decision 4: Unification runs at feature execution time, not at bake time

**Choice:** The unification pass runs inside `readBakedMeshImportSolid` after the solid is built from baked mesh data, but only for inputs small enough to keep commit/rebuild latency bounded and for imports that were not classified as faceted fallback.

**Alternatives considered:**
- **Run during bake (in the worker)**: Would require OCC in the worker thread. Currently the worker only does topology analysis and JSON baking — no OCC dependency.

**Rationale:** Feature execution already has OCC loaded. Keeping the bake phase OCC-free preserves the current worker architecture. `ShapeUpgrade_UnifySameDomain` can become extremely slow on large triangle-heavy fallback meshes, so the execution path records diagnostics and keeps the restored solid unchanged when the same-domain merge would be unbounded.

### Decision 5: Add a narrow cylinder rebuild path before STL shell restore

**Choice:** Before writing the baked mesh payload back to STL, detect simple full cylinders by looking for an axis-aligned side band with constant radius plus triangles on both cap planes. When detected, build an OCC `BRepPrimAPI_MakeCylinder` with the recovered axis, radius, and height.

**Rationale:** `ShapeUpgrade_UnifySameDomain` can merge faces that already share the same underlying surface, but STL cylinder sides are planar facets and do not carry cylindrical surface domains. A narrow cylinder rebuild satisfies the cylinder recovery requirement without introducing a broad segmentation or NURBS fitting system.

**Limitations:** This first rebuild path is intentionally conservative: it targets complete, axis-aligned cylinders with planar caps. Non-axis-aligned cylinders, partial cylinders, cones, spheres, and freeform organic meshes continue through the STL shell restore. Large or explicitly faceted fallback meshes skip same-domain unification to avoid blocking import commit.

### Decision 6: Do not synchronously worker-validate faceted fallback mesh imports

**Choice:** In the browser worker-backed adapter, validation for documents containing a faceted fallback mesh import stages the authored document and asset bytes without calling `rebuildDocument`.

**Rationale:** The imported baked asset is already parsed, topology-checked, and accepted before commit. Running a full worker rebuild during commit still forces OCC to restore thousands of raw triangle faces before the progress dialog can close. Deferring that rebuild to the normal snapshot refresh keeps commit bounded while preserving the existing worker refresh path.

## Risks / Trade-offs

- **[Risk] Unification may over-merge near-coplanar faces that are intentionally distinct** → Mitigation: Use conservative default tolerance (0.01). Expose tolerance override in settings so users can tighten it.
- **[Risk] Unification on very large meshes (50k faces) could be slow** → Mitigation: Bound same-domain unification to small/non-fallback inputs and preserve faceted fallback meshes without running the expensive merge pass.
- **[Risk] Face count reduction changes topology naming seeds, breaking any saved face references from before this change** → Mitigation: Mesh imports are new; no production documents reference mesh face IDs yet. No migration needed.
- **[Trade-off] Freeform/organic meshes will still have many small faces after unification** → Accepted. `UnifySameDomain` only merges faces with identical analytical surface type. NURBS fitting is a future enhancement.
