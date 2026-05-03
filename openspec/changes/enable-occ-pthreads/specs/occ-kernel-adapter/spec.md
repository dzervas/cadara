## MODIFIED Requirements

### Requirement: OCC adapter preserves clear separation between public contract data and internal kernel state
An OpenCascade-backed kernel adapter SHALL keep internal OCC-only geometry, bookkeeping, browser runtime ownership, and browser threading prerequisites private when the public contract does not expose that data, while still returning contract-valid snapshots, diagnostics, and render exports through one authoritative browser OCC runtime owner.

#### Scenario: Construction plane requires internal plane geometry
- **WHEN** the adapter needs explicit geometric plane data to rebuild or resolve an internal OCC construction plane but the public snapshot does not expose that geometry
- **THEN** the adapter keeps that internal representation private and still returns the public construction snapshot shape defined by the modeling contract

#### Scenario: Adapter evaluates committed authoring state in the browser
- **WHEN** the adapter serves browser snapshot generation or accepted document mutations
- **THEN** one authoritative browser OCC runtime owner evaluates the committed durable authoring state through the pthread-enabled OCC browser runtime
- **AND** the adapter does not split authoritative browser OCC state across competing main-thread, non-threaded, or alternate worker-owned runtimes

#### Scenario: Browser runtime ownership remains internal
- **WHEN** the adapter routes snapshot or mutation work through its chosen browser OCC runtime owner
- **THEN** the frontend continues to receive only the public modeling contract data and documented diagnostics
- **AND** the contract does not require frontend components to reason about OCC runtime placement, duplication, synchronization, or browser threading prerequisites

#### Scenario: Browser runtime prerequisites are not satisfiable
- **WHEN** the authoritative browser OCC runtime owner cannot start the pthread-enabled OCC runtime because required browser prerequisites are missing
- **THEN** the adapter surfaces a structured runtime failure through the documented error path
- **AND** it does not initialize a separate fallback adapter runtime with different execution semantics
