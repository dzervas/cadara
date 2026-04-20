# tool-icon-definition Specification

## Purpose
TBD - created by archiving change centralize-tool-icons. Update Purpose after archive.
## Requirements
### Requirement: Tool icon assets SHALL have one shared definition source
The system SHALL define the mapping from each `ToolIconId` to its local SVG asset in one shared tool icon definition source that is not owned by a single workbench surface.

#### Scenario: Resolve a tool icon asset
- **WHEN** any workbench surface needs the asset path for a tool icon such as `extrude`, `sketch`, or `dimension`
- **THEN** it resolves the asset path from the shared tool icon definition source
- **AND** the asset path matches the toolbar's existing local SVG asset choice for that `ToolIconId`

#### Scenario: Add a new tool icon
- **WHEN** a developer adds a new `ToolIconId`
- **THEN** the developer defines its local SVG asset in the shared tool icon definition source
- **AND** toolbar, feature history, and other tool-aware consumers can use that icon without adding a second asset filename mapping

### Requirement: Tool-aware workbench surfaces SHALL reuse shared tool icons
The toolbar, feature history, sketch history, and Parts & Objects surfaces SHALL render tool or modeling-concept icons through the shared tool icon definition source whenever the represented item maps to an existing `ToolIconId`.

#### Scenario: Render a committed feature in history
- **WHEN** the feature history renders a committed feature whose authoring definition has tool icon metadata
- **THEN** the history item uses the shared icon asset for that feature's `ToolIconId`
- **AND** it does not choose a separate generic workbench icon for that feature type

#### Scenario: Render a sketch-related history item
- **WHEN** sketch history renders a sketch entity, sketch constraint, or sketch dimension item
- **THEN** the item uses a shared tool icon definition for the matching sketch, constraint, or dimension concept

#### Scenario: Render Parts & Objects entries
- **WHEN** Parts & Objects renders an item that represents a sketch or another concept with an existing `ToolIconId`
- **THEN** the row uses the shared tool icon asset for that concept
- **AND** unrelated generic body, component, visibility, and context-menu action icons may remain on the generic workbench icon set

### Requirement: Generic workbench icons SHALL remain separate from tool icons
The system SHALL keep non-tool shell and action icons in a generic workbench icon set rather than adding them to `ToolIconId`.

#### Scenario: Render a generic action icon
- **WHEN** the workbench renders actions such as rename, delete, export, visibility, file, or close
- **THEN** those actions may continue to render through the generic workbench icon set
- **AND** they are not required to have `ToolIconId` entries

