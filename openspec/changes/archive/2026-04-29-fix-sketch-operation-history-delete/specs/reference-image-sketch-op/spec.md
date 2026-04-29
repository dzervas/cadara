## MODIFIED Requirements

### Requirement: Reference-image operations SHALL support independent history and deletion
Each committed `referenceImage` operation SHALL participate in sketch history as its own operation row. Deleting one reference image from sketch-local history SHALL remove that image operation row and its operation-owned follow-up state without affecting other committed reference images in the sketch.

#### Scenario: Delete one of multiple reference images
- **WHEN** a sketch contains multiple committed `referenceImage` operations and the user deletes one of their sketch-history rows
- **THEN** the targeted reference-image operation row is removed from the sketch definition's authoring operation list
- **AND** the editor does not append a new deletion history step for that action
- **AND** only the targeted image disappears from the sketch
- **AND** the remaining committed reference-image operations are preserved
