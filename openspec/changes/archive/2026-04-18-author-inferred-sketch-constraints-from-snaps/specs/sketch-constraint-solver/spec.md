## ADDED Requirements

### Requirement: Sketch solver SHALL evaluate inferred constraint kinds
The sketch solver SHALL evaluate durable constraint kinds required by supported snap-derived relationships, including midpoint, point-on-curve, tangent, and concentric constraints.

#### Scenario: Midpoint constraint solves
- **WHEN** a sketch contains a midpoint constraint between a point and a line
- **THEN** the solver positions the point at the solved midpoint of the line when the system is satisfiable

#### Scenario: Tangent constraint solves
- **WHEN** a sketch contains a supported tangent constraint between two supported curve entities
- **THEN** the solver satisfies the tangency relationship within tolerance or reports an unsatisfied diagnostic
