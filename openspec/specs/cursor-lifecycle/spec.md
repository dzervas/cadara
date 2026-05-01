# cursor-lifecycle Specification

## Purpose

Define the explicit cursor lifecycle used when the editor rolls back document history to reopen committed sketch and feature edit sessions, then restores the prior cursor afterward.

## Requirements

### Requirement: Cursor lifecycle SHALL formalize phase transitions as explicit functions
The cursor lifecycle module SHALL expose explicit transition functions for the 5-phase `EditSessionCursorContext` lifecycle (`rollingBack -> opening -> active -> restorePending -> restoring`) instead of relying on scattered conditional checks.

#### Scenario: Advance from rollingBack to opening
- **WHEN** a snapshot refresh completes while the cursor phase is `rollingBack`
- **THEN** the cursor lifecycle advances to `opening`
- **AND** returns an action indicating the next step (open sketch session or hydrate feature)

#### Scenario: Advance from opening to active
- **WHEN** the session open or feature hydration effect completes successfully
- **THEN** the cursor lifecycle advances to `active`

#### Scenario: Advance from active to restorePending
- **WHEN** a commit effect completes for the active edit session
- **THEN** the cursor lifecycle advances to `restorePending`
- **AND** returns an action indicating cursor restoration is needed

#### Scenario: Advance from restorePending to restoring
- **WHEN** a cursor restoration effect is initiated
- **THEN** the cursor lifecycle advances to `restoring`

#### Scenario: Complete lifecycle after restoring
- **WHEN** the restoration snapshot refresh completes while the cursor phase is `restoring`
- **THEN** the cursor lifecycle returns null indicating the context should be cleared

### Requirement: Cursor lifecycle SHALL determine the correct follow-up action for each phase
The cursor lifecycle module SHALL expose a function that returns the appropriate follow-up action based on the current phase, replacing the conditional logic in `continueAfterSnapshotRefresh`.

#### Scenario: rollingBack phase triggers session open for sketch targets
- **WHEN** the cursor phase is `rollingBack` and the target is a sketch feature
- **THEN** the follow-up action is `openSession`

#### Scenario: rollingBack phase triggers hydration for non-sketch targets
- **WHEN** the cursor phase is `rollingBack` and the target is a non-sketch feature
- **THEN** the follow-up action is `hydrateFeature`

#### Scenario: restorePending phase triggers cursor restore
- **WHEN** the cursor phase is `restorePending`
- **THEN** the follow-up action is `restore`

#### Scenario: restoring phase triggers completion
- **WHEN** the cursor phase is `restoring`
- **THEN** the follow-up action is `complete`

### Requirement: Cursor lifecycle module SHALL be self-contained
The cursor lifecycle module SHALL not import from transition handlers or the root reducer. It SHALL operate only on `EditSessionCursorContext` and return phase transitions and action indicators.

#### Scenario: No circular dependencies
- **WHEN** the cursor lifecycle module is imported by transition handlers
- **THEN** it does not import back from those handlers or from the root reducer
