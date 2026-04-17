## Why

Projected reference geometry should be able to participate in sketch profiles without becoming copied sketch geometry. This enables live-derived profiles whose boundaries update from referenced model topology while preserving a strict no-copy reference model.

## What Changes

- Allow derived sketch regions to include projected geometry boundary segments.
- Persist enough reference and projection identity to rebuild profiles from live-derived projected geometry at the active document revision.
- Update OCC profile building to resolve projected boundary segments through the solver/reference projection boundary instead of copying curves into the sketch.
- Remove the current projected-region-loop rejection only when live-derived reconstruction is available.
- Enforce that referenced/projected geometry is never copied into local sketch-owned entities as part of this workflow.

## Capabilities

### New Capabilities
- `sketch-derived-reference-profiles`: Defines profile and region behavior when boundaries include live-derived projected reference geometry.

### Modified Capabilities
- `sketch-constraint-solver`: Region extraction can emit projected geometry boundary segments when projected references close a region.
- `occ-kernel-adapter`: OCC profile building resolves projected geometry boundary segments from live projection data instead of rejecting them or copying geometry.
- `profile-based-feature-contract`: Profile references backed by derived projected geometry rebuild from live references and report invalidation explicitly.

## Impact

- Affected areas: sketch region extraction, projected geometry persistence/resolution, OCC profile building, feature rebuild invalidation, diagnostics, and tests.
- Depends on `add-sketch-reference-geometry-authoring`.
- Must use live-derived Option A semantics. Copying referenced geometry into sketch-owned points/entities is explicitly forbidden.
