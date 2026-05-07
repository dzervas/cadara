## ADDED Requirements

### Requirement: Active sketch pointer preview updates SHALL be coalesced and no-op aware
The editor SHALL coalesce active sketch pointer preview movement to animation frames and SHALL avoid producing a new sketch session state when the pointer move cannot change active sketch authoring feedback.

#### Scenario: Multiple pointer preview moves occur before a frame
- **WHEN** several projected sketch pointer moves occur during one animation frame while an active sketch drawing or placement preview can change
- **THEN** the editor processes one pointer preview update for that frame
- **AND** the processed update uses the latest projected sketch-plane point from those pointer moves

#### Scenario: Pointer moves with no active preview state
- **WHEN** the user is editing a sketch and pointer movement cannot affect an active drawing tool, placement tool, snap candidate, pending anchor, hover-relevant sketch state, or direct drag
- **THEN** the editor leaves the active sketch session state unchanged
- **AND** workbench renderable composition is not invalidated by that no-op pointer movement

#### Scenario: Acceptance uses the latest pending pointer
- **WHEN** a click, key command, or tool acceptance consumes the current pointer position while a coalesced pointer preview update is pending
- **THEN** the editor applies or flushes the latest pending projected pointer before evaluating the acceptance
- **AND** the accepted sketch operation uses the latest pointer position rather than an older rendered preview position

### Requirement: Active sketch display SHALL reuse stable accepted renderables during pointer-only preview updates
The editor SHALL keep accepted active-sketch display derivation separate from transient pointer and tool preview overlays so pointer-only preview movement does not re-solve unchanged accepted sketch geometry or rebuild unchanged accepted renderables.

#### Scenario: Drawing preview moves over unchanged accepted geometry
- **WHEN** an active drawing tool updates only its transient pointer preview and the accepted sketch definition, projected references, solved snapshot, region state, diagnostics, styles, and history cursor are unchanged
- **THEN** the editor reuses the stable accepted active-sketch display basis
- **AND** it updates only transient preview renderables needed for the active tool feedback
- **AND** it does not run a full sketch solve merely to display unchanged accepted geometry

#### Scenario: Accepted sketch geometry changes
- **WHEN** a sketch edit changes the accepted sketch definition or accepted solved sketch basis
- **THEN** the editor invalidates the stable accepted active-sketch display basis
- **AND** the next display derivation reflects the changed accepted geometry

#### Scenario: Region or diagnostic state changes after deferred refresh
- **WHEN** live region extraction or sketch diagnostics refresh after a deferred update
- **THEN** the editor invalidates the stable accepted active-sketch display basis
- **AND** viewport feedback uses the refreshed region or diagnostic state

#### Scenario: Direct constrained drag remains solver-backed
- **WHEN** the user drags constrained editable sketch geometry
- **THEN** the editor continues to use the direct constrained drag interactive solve lifecycle
- **AND** accepted drag frames invalidate stable accepted display only when the accepted solved sketch basis changes
