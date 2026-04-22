## Context

The mesh import path bakes geometry and discards the source mesh. Initial conversion must therefore be conservative, while later reconstruction should recover higher-quality CAD topology for common mechanical meshes. This change formalizes reconstruction quality, settings, diagnostics, and fallback behavior on top of the mesh baked import path.

## Goals / Non-Goals

**Goals:**
- Recover common analytic surfaces when confidence is high.
- Provide deterministic reconstruction settings and algorithm-version provenance.
- Classify results as analytic, faceted fallback, rejected, or future mesh-body exception.
- Keep strict rejection before faceted fallback and persistent mesh body as the last-resort future path.
- Preserve the rule that STL/3MF source bytes are not saved.

**Non-Goals:**
- Guarantee exact reconstruction for arbitrary meshes.
- Retain source mesh files to support future reprocessing.
- Add a persistent mesh-body document model in this change.
- Infer design intent such as original sketch dimensions, constraints, or feature history.

## Decisions

1. Use confidence-gated analytic reconstruction.
   - Planar and cylindrical recovery are first-class targets because they are common and testable.
   - Other surface types can be added only when diagnostics and validation can distinguish reliable recovery from guesswork.

2. Record reconstruction provenance on baked assets.
   - Baked asset metadata includes algorithm id/version, settings, result classification, source hash, and quality metrics.
   - This makes old documents stable when future reconstruction algorithms change.

3. Apply fallback order A > B > C.
   - A: strict rejection when no valid durable geometry can be produced.
   - B: faceted baked geometry when topology is valid and size/quality limits are acceptable.
   - C: persistent mesh body only as a future explicit exception, not the default import behavior.

4. Surface quality diagnostics before commit.
   - Users should know if the result is analytic, faceted, or rejected before accepting.
   - Diagnostics must explain source discard and whether re-importing is required to try different settings later.

## Risks / Trade-offs

- [Risk] Analytic fitting can over-recognize noisy meshes. → Mitigation: use conservative confidence thresholds and reject or faceted-fallback uncertain regions.
- [Risk] Faceted fallback creates large geometry assets. → Mitigation: enforce limits and report when fallback is too heavy to save.
- [Risk] Users may mistake recovered geometry for original design intent. → Mitigation: label reconstructed/baked results distinctly in provenance and diagnostics.
- [Risk] Deterministic reconstruction can vary by dependency version. → Mitigation: store baked output and algorithm-version metadata; restore never reruns from missing source.

## Migration Plan

Existing baked mesh imports keep their prior baked asset and provenance. New reconstruction metadata is added for newly imported or reconverted meshes only.

## Open Questions

- Initial numeric thresholds for planar/cylindrical fitting confidence.
- Whether the UI should expose advanced reconstruction settings immediately or start with a compact quality preset.
