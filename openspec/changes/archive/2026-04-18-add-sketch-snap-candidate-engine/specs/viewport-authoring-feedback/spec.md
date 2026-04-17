## ADDED Requirements

### Requirement: Viewport feedback SHALL show active snap candidates
The viewport SHALL render transient snap indicators for the active sketch snap candidate without storing those indicators as durable sketch data.

#### Scenario: Midpoint snap is active
- **WHEN** the active snap candidate is a midpoint
- **THEN** the viewport shows a midpoint snap indicator at the snapped sketch-space point

#### Scenario: Snap candidate changes
- **WHEN** pointer movement changes the active snap candidate
- **THEN** the viewport updates the transient snap indicator and removes stale snap feedback
