## ADDED Requirements

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
