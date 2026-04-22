## ADDED Requirements

### Requirement: Generic document deletion SHALL remove supported durable targets
The modeling contract SHALL provide one durable deletion mutation that accepts supported document history items and supported parts or objects by stable durable identity, validates the request against the current document revision, commits accepted deletion through the document mutation boundary, and returns a rebuilt snapshot result.

#### Scenario: Delete committed feature history item
- **WHEN** the client requests generic deletion for a committed feature history item at the current document revision
- **THEN** the modeling boundary removes that feature from authored document history
- **AND** the rebuilt snapshot no longer includes the deleted feature history item
- **AND** the response identifies the deleted target and all changed durable targets owned by the deletion

#### Scenario: Delete committed sketch history item
- **WHEN** the client requests generic deletion for a committed sketch history item at the current document revision
- **THEN** the modeling boundary removes that sketch from authored document history
- **AND** the rebuilt snapshot no longer includes the deleted sketch history item
- **AND** later features with invalidated sketch references report rebuild diagnostics instead of silently remapping those references

#### Scenario: Delete supported part or body row
- **WHEN** the client requests generic deletion for a supported whole part or body row at the current document revision
- **THEN** the modeling boundary applies the shared body deletion plan for that durable body target
- **AND** the rebuilt Parts & Objects tree no longer includes that deleted body target

#### Scenario: Reject unsupported deletion target
- **WHEN** the client requests generic deletion for a target that the modeling boundary cannot delete generically
- **THEN** the modeling boundary rejects the mutation with diagnostics that identify the unsupported target
- **AND** the authored document stored by `DocumentRepository` remains unchanged

#### Scenario: Reject stale deletion request
- **WHEN** the client requests generic deletion against a stale base revision
- **THEN** the modeling boundary reports a revision conflict
- **AND** the authored document stored by `DocumentRepository` remains unchanged

### Requirement: Generic deletion SHALL preserve valid document cursor state
Generic document deletion SHALL leave the document cursor unchanged when it still references a live history item and SHALL move it to a valid cursor position when the deleted item was the cursor target.

#### Scenario: Cursor references deleted item
- **WHEN** a generic deletion removes the document history item referenced by the current document cursor
- **THEN** the accepted mutation sets the cursor to a valid remaining document history position or the empty cursor
- **AND** the refreshed timeline does not expose an invalid cursor state

#### Scenario: Cursor references live item
- **WHEN** a generic deletion removes a document history item that is not the current cursor target
- **THEN** the accepted mutation preserves the current cursor when that cursor still resolves to a live history item
