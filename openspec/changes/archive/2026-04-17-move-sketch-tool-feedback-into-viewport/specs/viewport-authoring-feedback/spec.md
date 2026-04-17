## ADDED Requirements

### Requirement: Active sketch drawing feedback SHALL render inside the viewport
The workbench viewport SHALL render active sketch drawing measurements and numeric inputs as viewport overlays near the geometry being authored.

#### Scenario: User creates a circle
- **WHEN** the user is creating a circle in sketch mode
- **THEN** the viewport shows the live diameter or radius near the outer edge of the circle being created

#### Scenario: User creates a rectangle
- **WHEN** the user is creating a rectangle in sketch mode
- **THEN** the viewport shows the live width and height near the rectangle geometry being created

#### Scenario: User creates a line
- **WHEN** the user is creating a line in sketch mode
- **THEN** the viewport shows live line measurements near the active line rather than in a detached feature-editor-style panel
