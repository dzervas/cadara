## ADDED Requirements

### Requirement: Empty viewport clicks SHALL clear selection
The workbench viewport SHALL clear the current selection when the user primary-clicks empty viewport space, regardless of the current tool state.

#### Scenario: Empty click with no active tool
- **WHEN** the user has a workbench selection and primary-clicks empty space inside the viewport with no active tool
- **THEN** the workbench clears the current selection

#### Scenario: Empty click with active tool
- **WHEN** the user has a workbench selection and primary-clicks empty space inside the viewport while a tool is active
- **THEN** the workbench clears the current selection

#### Scenario: Target click keeps selection routing
- **WHEN** the user primary-clicks a selectable target inside the viewport
- **THEN** the viewport routes the click through the existing target selection behavior instead of treating it as empty space
