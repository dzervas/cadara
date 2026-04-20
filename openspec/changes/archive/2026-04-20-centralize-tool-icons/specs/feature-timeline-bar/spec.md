## MODIFIED Requirements

### Requirement: Timeline features SHALL be compact icon-only controls
The bottom feature timeline bar SHALL render each feature as a single icon-only control using the same icon sizing as toolbar tools and the shared tool icon definition for that feature when feature tool metadata exists.

#### Scenario: Feature icon renders without inline label
- **WHEN** the bottom feature timeline bar renders a feature
- **THEN** the visible timeline item contains one feature icon resolved from the shared tool icon definition source when the feature has tool icon metadata
- **AND** the visible timeline item does not render the feature label as inline timeline text

#### Scenario: Feature control remains accessible
- **WHEN** a screen reader or keyboard user focuses a feature timeline item
- **THEN** the control exposes an accessible label that identifies the feature

#### Scenario: Sketch history icon uses shared tool metadata
- **WHEN** the sketch history timeline renders a sketch dimension, constraint, or entity item that maps to an existing `ToolIconId`
- **THEN** the item icon is resolved from the shared tool icon definition source instead of a separate generic workbench icon mapping
