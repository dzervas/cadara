# occ-kernel-adapter Specification

## Purpose
TBD - created by archiving change formalize-kernel-adapter-boundary. Update Purpose after archive.
## Requirements
### Requirement: OCC adapter implements the public modeling contract without frontend leakage
An OpenCascade-backed kernel adapter SHALL satisfy the public modeling contract through the documented adapter surface and SHALL not take ownership of frontend interaction concerns.

#### Scenario: OCC adapter serves modeling operations
- **WHEN** the application uses an OCC-backed kernel adapter for snapshot, sketch commit, feature operations, preview evaluation, or reference resolution
- **THEN** the adapter responds in the public modeling contract shape rather than exposing OCC-specific UI workflows or kernel internals to frontend components

#### Scenario: Frontend performs interactive editing
- **WHEN** the user performs pointer-driven drafting, hover interaction, toolbar changes, or local previews
- **THEN** those concerns remain outside the OCC adapter and are not modeled as kernel-owned interaction APIs

### Requirement: OCC adapter preserves clear separation between public contract data and internal kernel state
An OpenCascade-backed kernel adapter SHALL keep internal OCC-only geometry and bookkeeping private when the public contract does not expose that data, while still returning contract-valid snapshots, diagnostics, and render exports.

#### Scenario: Construction plane requires internal plane geometry
- **WHEN** the adapter needs explicit geometric plane data to rebuild or resolve an internal OCC construction plane but the public snapshot does not expose that geometry
- **THEN** the adapter keeps that internal representation private and still returns the public construction snapshot shape defined by the modeling contract

#### Scenario: Adapter rebuilds committed authoring state
- **WHEN** the adapter evaluates an accepted document mutation
- **THEN** it rebuilds authoritative committed model state from durable authoring data and returns only contract-valid results to the frontend

### Requirement: OCC adapter rejects unsupported contract gaps explicitly
An OpenCascade-backed kernel adapter SHALL reject public-contract cases that are not faithfully implementable from the documented contract instead of inventing hidden OCC-specific semantics.

#### Scenario: Revolve uses a construction-backed axis that is not publicly representable
- **WHEN** a revolve request uses a construction-backed axis that the public contract does not define precisely enough to reconstruct
- **THEN** the adapter returns structured diagnostics or rejection rather than inferring an axis from hidden implementation rules

#### Scenario: Committed region reconstruction depends on unavailable projected geometry
- **WHEN** feature execution requires projected sketch geometry that is not reconstructible from the committed public contract
- **THEN** the adapter rejects the operation explicitly and reports the contract limitation to the caller

### Requirement: OCC profile building SHALL consume live-derived projected boundaries
The OCC adapter SHALL build profile wires containing projected geometry boundary segments from live projection data for the active revision.

#### Scenario: Projected segment is resolvable
- **WHEN** the OCC adapter receives a region loop containing a projected geometry segment with live projected geometry available
- **THEN** it reconstructs the corresponding wire segment from the projected geometry
- **AND** it does not reject the loop because of projected geometry

#### Scenario: Projected segment is not resolvable
- **WHEN** the OCC adapter cannot resolve live projected geometry for a projected region segment
- **THEN** it rejects the rebuild with an explicit machine-readable diagnostic
- **AND** it does not copy, cache-as-authoritative, or silently remap the referenced geometry

