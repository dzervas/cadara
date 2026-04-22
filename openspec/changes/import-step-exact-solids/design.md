## Context

STEP files preserve BREP topology and are the first exact geometry import format. The geometry asset substrate stores original STEP bytes internally and provides self-contained save/load plus peer asset sync. This change consumes that substrate by adding an authored import feature that replays STEP bytes through OCC during restore.

## Goals / Non-Goals

**Goals:**
- Import STEP files as exact OCC solids from retained source bytes.
- Preserve the original STEP file as an immutable document asset.
- Expose imported bodies through normal body, face, edge, and vertex selection.
- Import every supported solid in a STEP file as a separate body with deterministic labels.
- Add a compact import UI for file selection, units/scale/orientation, progress, and errors.

**Non-Goals:**
- Import STL or 3MF files.
- Reconstruct meshes or generate baked geometry from triangles.
- Edit STEP source bytes after import.
- Preserve every STEP assembly/product-structure detail in the first implementation.

## Decisions

1. Represent STEP import as an authored feature.
   - The feature stores the referenced STEP asset id and deterministic import settings.
   - Rebuild reads the asset and produces OCC body topology like other solid features.
   - Alternative considered: store imported bodies directly in the authored document. That would bypass replay and duplicate derived geometry.

2. Retain original STEP bytes as the asset source of truth.
   - This keeps the import reproducible and self-contained.
   - Topology is derived on rebuild, not stored as serialized OCC objects.

3. Normalize units and placement at import boundaries.
   - Import settings record explicit unit interpretation, scale, coordinate orientation, and initial transform.
   - If STEP metadata and user settings conflict, the accepted feature records the final resolved values.

4. Treat imported topology as ordinary exact body topology.
   - Imported body ids and subshape ids are created by the OCC topology/naming layer.
   - Downstream features reference imported faces, edges, vertices, and bodies through existing durable refs.

5. Flatten supported STEP solids into document bodies.
   - The first implementation imports all OCC-readable supported solid shapes as separate bodies.
   - Body labels are derived deterministically from STEP names when available and fall back to file/import ordering.
   - Unsupported non-solid geometry is rejected when it would be the only result or reported as an import diagnostic when supported solids can still be imported without missing referenced geometry.

## Risks / Trade-offs

- [Risk] STEP assemblies can produce multiple solids and product hierarchy. → Mitigation: flatten supported solids into deterministic bodies and report unsupported non-solid content explicitly.
- [Risk] Topological naming for imported bodies can change if OCC reader behavior changes. → Mitigation: retain original STEP bytes and use the existing topology reconciliation rules where applicable.
- [Risk] Large STEP files can make restore slow. → Mitigation: run OCC import in the worker and surface progress/pending state.
- [Risk] STEP units may be ambiguous. → Mitigation: require explicit resolved import unit/scale in the authored feature.

## Migration Plan

No existing documents contain STEP imports. Documents without asset manifests or import features are unaffected.

## Open Questions

- Whether STEP import exposes assembly/product hierarchy in the object tree later, beyond deterministic imported body labels.
