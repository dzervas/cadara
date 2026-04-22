## Why

Mesh-imported solids (STL/3MF) currently carry one triangular face per source triangle, producing thousands of indistinguishable micro-faces. This makes face selection impossible in the viewport and prevents downstream operations (fillet, chamfer, draft, sketch-on-face) from targeting meaningful geometry. OpenCascade already includes `ShapeUpgrade_UnifySameDomain` which merges adjacent faces that share the same analytical surface — the same pass used after booleans — but it is never applied to mesh imports. Enabling it would recover planar, cylindrical, conical, spherical, and toroidal faces automatically, closing most of the quality gap between mesh and STEP imports at near-zero implementation cost.

## What Changes

- Apply bounded `ShapeUpgrade_UnifySameDomain` to eligible mesh-imported solids after `BRepBuilderAPI_MakeSolid` conversion, merging tessellation triangles into analytical faces where the underlying surface is identical within tolerance.
- Add a conservative analytic rebuild path for simple full-cylinder mesh imports with planar caps, producing real cylindrical and planar OCC faces before falling back to shell restore.
- Skip the expensive same-domain merge pass for large meshes and explicitly faceted fallback imports so commit latency remains bounded.
- Enable durable topology naming (`seedNaming: true`) for recovered analytical mesh imports, while keeping faceted fallback imports on lightweight deterministic topology IDs so large raw triangle meshes remain importable.
- Record unification diagnostics (pre/post face count, merged surface types) in the mesh reconstruction provenance so users and future heuristics can assess recovery quality.
- Expose per-mesh unification tolerance overrides in `MeshReconstructionSettings` so the conservative default can be relaxed for noisier meshes.

## Capabilities

### New Capabilities
- `mesh-face-unification`: Kernel-level bounded post-import pass that merges tessellation triangles into analytical faces using OCC surface domain unification, with tolerance controls and provenance diagnostics.

### Modified Capabilities
- `mesh-baked-geometry-import`: Mesh import feature execution now runs a bounded unification pass and enables topology naming for eligible recovered solids, changing the face structure of eligible resulting solids.
- `mesh-reconstruction-fallbacks`: Reconstruction provenance gains unification diagnostics fields; faceted fallback solids now carry lightweight deterministic face IDs while preserving raw triangulation when unification would be too expensive.

## Impact

- **Kernel adapter** (`src/domain/modeling/occ/features.ts`): `readBakedMeshImportSolid` and `executeMeshImportFeature` gain a unification step and updated naming flag.
- **Contracts** (`src/contracts/modeling/mesh-import.ts`, `geometry-assets.runtime-schema.ts`): Reconstruction provenance schema extended with unification diagnostics.
- **Baked mesh geometry** (`src/domain/modeling/baked-mesh-geometry.ts`): Settings type extended with unification tolerance fields.
- **Viewport picking**: No code changes expected — face selection should work automatically once faces are proper topology entities with stable IDs.
- **Existing tests** (`opencascade-kernel-adapter.spec.ts`): Mesh import tests need updating to assert reduced face counts and face selectability.
