## Why

The first mesh import path should be conservative, but users will need better outcomes for common mechanical meshes. Reconstruction quality needs explicit rules for analytic recovery, faceted fallback, diagnostics, and any future mesh-body exception.

## What Changes

- Improve mesh reconstruction to recognize common analytic surfaces such as planes and cylinders when confidence is high.
- Add reconstruction settings and algorithm-version metadata to baked mesh import provenance.
- Add structured confidence and quality diagnostics so users understand whether the result is analytic, faceted, rejected, or requires manual intervention.
- Formalize the fallback policy: strict rejection first, faceted baked geometry second, persistent mesh body only as an explicit future exception.
- Keep the original STL/3MF source discarded by default and do not add a hidden source retention path.

## Capabilities

### New Capabilities
- `mesh-reconstruction-fallbacks`: Quality, settings, diagnostics, and fallback behavior for mesh-to-baked-geometry conversion.

### Modified Capabilities
- `mesh-baked-geometry-import`: Mesh imports use the improved reconstruction and fallback policy.
- `geometry-asset-substrate`: Baked geometry assets record reconstruction algorithm identity and quality metadata.
- `durable-modeling-contract`: Baked faceted results and recovered analytic results expose consistent durable body topology.
- `feature-authoring-definition`: Mesh import UI exposes reconstruction settings and diagnostic review where appropriate.

## Impact

- Reconstruction: segmentation, analytic fitting, validation, and faceted fallback criteria.
- Contracts: reconstruction provenance, quality diagnostics, and result classification.
- UI: result summary, warnings for faceted fallback, rejection diagnostics.
- Testing: analytic cylinder/plane recovery, faceted fallback, strict rejection, no source retention, deterministic rebuild from baked assets.
