## ADDED Requirements

### Requirement: Region extraction SHALL emit projected geometry segments for live-derived reference profiles
The sketch region extraction subsystem SHALL include projected geometry segment sources when valid projected reference geometry participates in a closed loop.

#### Scenario: Mixed loop contains projected segment
- **WHEN** solved local sketch geometry and projected reference geometry form a valid closed loop
- **THEN** derived region loop segments identify local entity sources and projected geometry sources in traversal order

#### Scenario: Projected segment cannot be resolved
- **WHEN** projected geometry required for loop extraction is unavailable or invalid
- **THEN** region extraction reports diagnostics and does not invent copied local geometry
