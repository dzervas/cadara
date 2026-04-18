## Why

Sketch reference geometry has the UI, selection contracts, durable sketch records, projected renderable support, and editor effect plumbing, but the actual projection behavior still depends on stubbed solver responses for real model and sketch sources. Users can author a reference, but supported external topology and existing sketch geometry do not yet become useful live projected sketch geometry.

## What Changes

- Implement live projection resolution for supported model vertices, linear/circular edges, planar faces, and existing sketch points/entities into the active sketch plane.
- Route active-sketch projection requests through the modeling/solver boundary using current document topology and existing sketch snapshots instead of returning blanket `unsupportedSource` diagnostics.
- Persist and refresh projected reference records on sketch commit, document rebuild, reload, and sketch re-entry.
- Use projected reference geometry as read-only context for selection, snapping, constraints, derived regions, and profile rebuilding without copying it into local sketch-owned geometry.
- Preserve explicit diagnostics for unsupported, missing, ambiguous, non-planar, or stale references.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sketch-external-reference-geometry`: Define concrete source resolution behavior for live model/sketch projections and refresh/invalidation across document revisions.
- `sketch-derived-reference-profiles`: Require live projected boundary segments to participate in derived region extraction and OCC profile rebuilds when projection succeeds.
- `sketch-reference-constraint-targets`: Require reference-targeted constraints to consume live projected records produced from authored external references.

## Impact

- Affected contracts: sketch reference definitions, solver projection responses, derived region boundary source records, and reference-targeted constraint operands.
- Affected domain/runtime areas: editor sketch projection effects, sketch session display/snap/constraint inputs, mock and OCC-backed solver adapters, modeling service commit/rebuild flows, and operation-history persistence.
- Affected tests: `bun:test` coverage for projection source resolution, editor effect refreshes, region extraction with mixed local/projected loops, OCC profile construction, diagnostics, and reload/re-entry behavior.
- No breaking API changes are intended; unsupported sources remain explicit diagnostics rather than silent conversion or deletion.
