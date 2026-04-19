## ADDED Requirements

### Requirement: Combine sessions SHALL expose body boolean form controls
Feature sessions SHALL provide Combine create and edit forms that expose target-body selection, tool-body selection, and boolean operation mode through the shared feature editor form schema.

#### Scenario: Combine form renders required body selectors
- **WHEN** a Combine create or edit session is active
- **THEN** the feature inspector renders target-body and tool-body reference selectors
- **AND** both selectors preserve durable body references in the draft

#### Scenario: Combine form renders operation mode
- **WHEN** a Combine create or edit session is active
- **THEN** the feature inspector renders an operation control for `add`, `subtract`, and `intersect`

#### Scenario: Complete Combine draft enables preview and commit
- **WHEN** the Combine draft contains required body participants and a supported operation mode
- **THEN** preview and commit actions are allowed to issue modeling requests derived from that draft

#### Scenario: Incomplete Combine draft blocks commit
- **WHEN** the Combine draft is missing a required body participant or operation mode
- **THEN** commit remains blocked or returns form diagnostics
- **AND** the session does not fabricate missing references from unrelated selection state

