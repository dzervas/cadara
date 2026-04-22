## ADDED Requirements

### Requirement: Workbench SHALL expose STL and 3MF import
The workbench import surface SHALL allow users to select STL and 3MF files for mesh-to-baked-geometry import.

#### Scenario: User imports mesh file
- **WHEN** the user chooses Import and selects an `.stl` or `.3mf` file
- **THEN** the workbench starts the mesh import flow with source-discard warning, file validation, progress feedback, and conversion diagnostics
