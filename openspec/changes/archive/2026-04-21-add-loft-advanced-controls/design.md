## Context

Loft currently supports ordered profiles, optional guide curves, operation intent, target bodies, and an untyped options object. Onshape distinguishes several loft controls: guides are boundary rails that touch profile boundaries, path is a centerline-equivalent global shape control with section count, start/end profile conditions define derivative constraints, and connections control twist/alignment.

The contract should preserve these as separate concepts even if the initial kernel implementation supports only a subset of combinations.

## Goals / Non-Goals

**Goals:**
- Add path as an optional participant distinct from guide curves.
- Store path section count under the path option with default `5`.
- Represent guide curves and guide continuity explicitly.
- Represent start and end profile conditions.
- Represent match connections for profile alignment.
- Allow path and guides to coexist in the contract.
- Implement OCC geometry for supported cases and diagnostics for invalid geometry.

**Non-Goals:**
- Do not add surface or thin loft variants.
- Do not add isocurve display/debug controls as modeling behavior.
- Do not require Onshape-identical UI layout.

## Decisions

1. Keep path distinct from guides.

   Path is a centerline-like control that creates intermediate reference sections. Guide curves are boundary controls that should touch profile boundaries. They are separate participant roles and should not be collapsed into one `curveControls` list.

2. Scope `sectionCount` to path.

   `sectionCount` has meaning only when path is active. The option default is `5`, and validation requires a positive integer.

3. Allow path and guides together in the contract.

   The durable definition can represent both. The OCC adapter may support or reject specific combinations with structured diagnostics, but the contract should not erase the user's authored intent.

4. Add continuity as explicit profile and guide controls.

   Profile start/end conditions and guide continuity should be named separately. This keeps future tangent/curvature behavior testable and avoids a vague "guides and continuity" blob.

5. Define a minimum implemented geometry matrix.

   This change must implement at least path-only lofts with section count, guide-only lofts with no guide continuity, one guide-continuity mode, start/end normal or tangent profile conditions where OCC can express them, and one match-connection alignment case between two ordered profiles. More complex combinations may return diagnostics, but these baseline cases cannot be treated as unsupported.

## Risks / Trade-offs

- Full guide continuity and match curvature are hard geometry problems -> implement at least one guide-continuity mode in the minimum matrix above and return precise diagnostics for more complex impossible cases.
- Connections require robust reference mapping across ordered profiles -> persist durable references and test invalidation explicitly.
- Path with non-planar profiles may be unsupported -> preserve the request and return a diagnostic rather than silently changing loft behavior.
