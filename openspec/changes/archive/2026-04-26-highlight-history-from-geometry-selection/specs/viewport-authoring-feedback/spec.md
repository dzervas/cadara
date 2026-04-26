## ADDED Requirements

### Requirement: Accepted viewport selections SHALL drive history contributor highlighting
The workbench viewport SHALL update the current history-bar contributor highlight set whenever a primary click resolves to a normal durable body-topology selection.

#### Scenario: Selecting shell geometry updates contributor highlights
- **WHEN** the user primary-clicks a selectable inner shell face
- **AND** the click resolves through the normal viewport selection path
- **THEN** the workbench selection target becomes that face
- **AND** the history highlight set updates from that face's contributor ancestry

#### Scenario: Selecting preserved topology updates contributor highlights precisely
- **WHEN** the user primary-clicks a selectable preserved back face on a shelled cube
- **AND** the click resolves through the normal viewport selection path
- **THEN** the workbench selection target becomes that face
- **AND** the history highlight set excludes unrelated downstream shell contribution

#### Scenario: Empty click clears contributor highlights
- **WHEN** the user primary-clicks empty viewport space and the current selection is cleared
- **THEN** the history-bar contributor highlight set is cleared together with the selection
