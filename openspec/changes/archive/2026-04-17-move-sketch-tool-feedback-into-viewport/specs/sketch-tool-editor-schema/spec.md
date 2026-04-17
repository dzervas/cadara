## ADDED Requirements

### Requirement: Sketch tool schema SHALL support geometry-anchored drawing feedback
The sketch tool presentation schema SHALL express live drawing measurements and inputs with anchors tied to sketch geometry, cursor position, or derived measurement references.

#### Scenario: Circle creation reports diameter at the circle edge
- **WHEN** a circle drawing tool is active and has a center and live radius
- **THEN** the schema exposes a diameter or radius label anchored near the active circle edge

#### Scenario: Rectangle creation reports width and height at their edges
- **WHEN** a rectangle drawing tool is active and has opposite corners
- **THEN** the schema exposes width and height labels anchored near the corresponding rectangle edges

#### Scenario: Floating input follows active sketch context
- **WHEN** a drawing tool requests numeric value entry
- **THEN** the schema provides an anchor that allows the input to render near the active geometry or cursor instead of in a fixed feature-panel position
