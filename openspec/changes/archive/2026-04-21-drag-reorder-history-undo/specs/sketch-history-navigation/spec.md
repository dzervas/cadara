## ADDED Requirements

### Requirement: Committed sketches SHALL participate in document history reordering
The normal document history SHALL treat committed sketches and committed features as reorderable authored document items in one shared order.

#### Scenario: Move sketch across feature boundary
- **WHEN** the user reorders a committed sketch before or after a committed feature in normal document history
- **THEN** the authored document history order contains the sketch at the accepted position
- **AND** the sketch remains addressable by the same durable sketch target from document history and `Parts & Objects`

#### Scenario: Reorder feature across sketch boundary
- **WHEN** the user reorders a committed feature before or after a committed sketch in normal document history
- **THEN** the authored document history order contains the feature at the accepted position
- **AND** the feature remains addressable by the same durable feature target from document history

#### Scenario: Active sketch edit keeps sketch-local history isolated
- **WHEN** an active sketch edit session is showing sketch-local history
- **THEN** document history item reordering is unavailable
- **AND** sketch-local history cursor movement remains the active history interaction

### Requirement: Document cursor SHALL remain target-based after history reordering
Document history reordering SHALL preserve the document cursor as a durable sketch, feature, or empty target instead of preserving only its previous visual index.

#### Scenario: Reorder item before cursor target
- **WHEN** the document cursor targets an authored item
- **AND** another document history item is reordered before that cursor target
- **THEN** the cursor still targets the same durable sketch or feature item
- **AND** applied history is recalculated from the target's accepted position in the new order

#### Scenario: Reorder cursor target
- **WHEN** the document cursor targets an authored item that is reordered
- **THEN** the cursor still targets that same durable sketch or feature item
- **AND** applied history is recalculated from the target's accepted position in the new order
