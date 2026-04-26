## ADDED Requirements

### Requirement: Timeline SHALL highlight contributor features for selected geometry
The bottom feature timeline bar SHALL render a derived highlighted state for every committed feature whose id appears in the current selected geometry target's contributor ancestry.

#### Scenario: Selecting an inner shell face highlights shell and extrude
- **WHEN** the current selection is an inner face created by a `Shell` feature from an earlier `Extrude`
- **THEN** the timeline highlights the `Extrude` history item
- **AND** the timeline highlights the `Shell` history item

#### Scenario: Selecting an unrelated back face highlights only extrude
- **WHEN** the current selection is a preserved back face on that same shelled cube
- **THEN** the timeline highlights the `Extrude` history item
- **AND** it does not highlight the `Shell` history item

#### Scenario: Clearing selection removes derived highlights without moving history
- **WHEN** the user clears the current viewport selection
- **THEN** the timeline removes any derived contributor highlight state
- **AND** the document cursor remains at its existing history position
