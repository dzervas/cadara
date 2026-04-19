## ADDED Requirements

### Requirement: Combine preview and commit SHALL use the modeling boundary
The frontend SHALL route Combine preview and commit requests through the modeling service boundary and SHALL NOT mutate body snapshots directly from toolbar, form, or viewport code.

#### Scenario: Combine preview reaches modeling service
- **WHEN** a valid Combine draft is previewed
- **THEN** the frontend sends a typed feature preview request through the modeling service boundary
- **AND** presentation components consume the returned preview renderables

#### Scenario: Combine commit reaches modeling service
- **WHEN** a valid Combine draft is committed
- **THEN** the frontend sends a typed feature create or update request through the modeling service boundary
- **AND** the committed snapshot comes from the modeling service response

#### Scenario: Combine toolbar activation remains editor-owned
- **WHEN** the user activates the Combine toolbar tool
- **THEN** editor runtime state opens or focuses a Combine feature session
- **AND** kernel execution does not occur until preview or commit is requested through the modeling boundary

