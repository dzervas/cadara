## Context

STL and 3MF triangle data does not contain reliable exact CAD topology. The product decision for this import path is to discard source meshes after import and save only resulting internal geometry. That makes the conversion boundary critical: the initial mesh import either produces a valid baked geometry asset through the basic converter or is rejected.

This change depends conceptually on the geometry asset substrate. STEP source bytes are retained by the STEP import path; mesh source bytes are intentionally not retained.

## Goals / Non-Goals

**Goals:**
- Import STL and triangle-only 3MF files transiently.
- Warn users before import that source mesh bytes will not be saved.
- Convert accepted mesh data into a baked geometry asset suitable for document restore when the basic converter can do so safely.
- Persist reconstruction/import provenance and diagnostics without saving raw mesh bytes or triangle arrays.
- Reject imports that cannot produce acceptable baked geometry.

**Non-Goals:**
- Retain original STL or 3MF source bytes.
- Persist mesh bodies as a normal saved document representation.
- Preserve 3MF materials, colors, build plates, textures, metadata, or manufacturing extensions.
- Provide faceted fallback policy, analytic recovery, or advanced reconstruction quality beyond the initial basic converter.

## Decisions

1. Discard mesh source bytes after conversion.
   - The saved document stores only the baked geometry asset plus provenance and settings.
   - The UI must warn that reconstruction settings cannot be changed from the saved document without re-importing the original file.
   - Alternative considered: save the source mesh asset. This was rejected for this product path.

2. Scope 3MF to geometry triangles only.
   - The parser extracts model vertices and triangles needed for conversion.
   - Materials, colors, units beyond resolved import settings, and build metadata are ignored or rejected when they affect geometry interpretation.

3. Persist baked geometry as an immutable asset.
   - The conversion result is serialized as generated baked geometry, not as transient OCC objects or render buffers.
   - The authored feature references the baked asset and records source provenance such as original filename, source format, source hash, and `sourceStored: false`.

4. Use strict import semantics in the initial mesh change.
   - If the basic converter can produce valid baked geometry, the import commits.
   - If the basic converter cannot produce valid baked geometry, the import is rejected.
   - Faceted fallback policy, analytic recovery, quality classifications, and persistent mesh-body fallback remain explicitly out of scope for this change.

## Risks / Trade-offs

- [Risk] Users may expect to tune reconstruction later. → Mitigation: show a clear pre-import warning and record source-discard provenance.
- [Risk] Basic conversion may reject meshes that a later faceted fallback could preserve. → Mitigation: report structured diagnostics and leave faceted fallback to the reconstruction fallback change.
- [Risk] Some valid 3MF files contain important transforms or units. → Mitigation: support only geometry/transforms required to place triangles correctly and reject unsupported geometry interpretation cases.
- [Risk] Conversion may be slow for medium meshes. → Mitigation: run parsing/conversion off the main thread and provide progress.

## Migration Plan

No existing documents contain mesh imports. This change adds new authored feature and baked asset records; existing documents remain unaffected.

## Open Questions

- Whether rejected mesh imports should keep a transient preview until the user dismisses diagnostics.
