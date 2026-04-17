## Context

The current contract already lets `RegionBoundarySegmentRecord.source` reference projected geometry, but OCC explicitly rejects those segments because committed sketch records do not yet carry enough reconstructible projected-geometry data for profile rebuilding. The product direction is strict: referenced geometry must always remain derived from its source reference and must never be copied into local sketch geometry for this workflow.

## Goals / Non-Goals

**Goals:**
- Let derived regions include boundary segments sourced from projected reference geometry.
- Rebuild profile wires by resolving live projected geometry from authored references at the active revision.
- Preserve invalidation diagnostics when projected boundaries cannot be resolved.
- Remove the OCC projected-region-loop rejection only after live-derived reconstruction is implemented.
- Enforce no-copy semantics in contracts, implementation policy, and tests.

**Non-Goals:**
- No copy/project-as-local-entity mode.
- No fallback to stale cached curves when live projection fails.
- No silent remapping of invalidated topology references.
- No broad topology naming overhaul beyond required invalidation handling.

## Decisions

### Use live-derived projected boundaries only

Projected profile boundary segments remain references to solver-projected geometry. OCC profile building must request or receive the active projection data needed to reconstruct wires. It must not materialize those projected curves as sketch-owned entities.

Alternative considered: copy projected geometry into construction entities. Rejected by product requirement and because it breaks live derivation.

### Persist reference identity, not copied geometry

The durable sketch/profile data should persist authored reference IDs, projected geometry IDs, and source reference identity. The actual curve geometry is derived during solve/rebuild for the active revision.

Alternative considered: persist projected curve coordinates as a cache. Rejected as an authoritative source. A non-authoritative cache may be used only for display performance if invalidated and never treated as the profile source of truth.

### Resolve projected segments before OCC wire construction

The OCC adapter should consume typed projected geometry records produced by the solver boundary when building profile wires. If any projected segment cannot be resolved, the feature rebuild reports explicit invalidation diagnostics.

## Risks / Trade-offs

- Live topology changes can invalidate projected profile boundaries -> preserve authored references and report invalidation rather than copying or silently remapping.
- Projection resolution can make rebuild slower -> cache only as non-authoritative display data, with active revision checks.
- Region extraction with projected segments can create mixed local/projected loops -> add direct tests for loop ordering, closure, and OCC wire reconstruction.
- Removing the OCC rejection too early would hide an unsafe contract gap -> keep the rejection until live-derived projected segment reconstruction is fully tested.
