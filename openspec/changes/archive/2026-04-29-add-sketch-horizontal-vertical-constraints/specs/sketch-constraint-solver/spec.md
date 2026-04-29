## MODIFIED Requirements

### Requirement: Sketch solver SHALL support analytical least-squares evaluation for supported authored constraints
The system SHALL evaluate supported sketch constraints and dimensions as explicit solver-owned loss terms with analytical gradients over the sketch parameter vector, so convergence behavior is deterministic and testable. Horizontal and vertical line constraints SHALL be interpreted in sketch-plane coordinates rather than world-space axes.

#### Scenario: Supported line and point constraints are present
- **WHEN** the authored sketch contains supported distance, angle, coincidence, horizontal, vertical, parallel, perpendicular, equal-length, or arc-endpoint constraints
- **THEN** the solver evaluates those authored facts as explicit loss terms and uses their analytical gradients during iteration

#### Scenario: Horizontal and vertical use sketch-plane axes
- **WHEN** the authored sketch contains a horizontal or vertical line constraint on any supported sketch plane
- **THEN** the solver evaluates that line orientation against the sketch plane local horizontal or vertical axis
- **AND** the solved result does not reinterpret the constraint against world-space axes

#### Scenario: A supported driving dimension is present
- **WHEN** the authored sketch contains a supported distance or radius dimension
- **THEN** the solver treats that authored dimension as a driving solve term and reports the solved value in the solved snapshot
