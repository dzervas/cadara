## ADDED Requirements

### Requirement: Applied history rebuild SHALL combine cursor range with feature suppression
The model document rebuild SHALL first derive the applied authored history range from the document cursor and SHALL then bypass suppressed features within that applied range without changing the cursor or deleting history.

#### Scenario: Cursor includes suppressed feature
- **WHEN** document history is `sketch - feature a - feature b`
- **AND** the cursor references `feature b`
- **AND** `feature a` is suppressed
- **THEN** rebuild applies the sketch and `feature b` only if their required references resolve without `feature a`
- **AND** `feature a` remains an applied history row with suppressed state
- **AND** the cursor still references `feature b`

#### Scenario: Cursor before suppressed feature
- **WHEN** document history is `sketch - feature a - feature b`
- **AND** the cursor references the sketch before `feature a`
- **AND** `feature a` is suppressed
- **THEN** rebuild output is identical to normal rollback before `feature a`
- **AND** suppression does not make `feature a` or `feature b` part of the applied geometry state

#### Scenario: Cursor target is suppressed
- **WHEN** the cursor references a suppressed feature
- **THEN** the cursor remains valid because the authored feature row still exists
- **AND** rebuild output includes applied unsuppressed rows before that cursor and excludes the suppressed cursor feature's generated geometry
