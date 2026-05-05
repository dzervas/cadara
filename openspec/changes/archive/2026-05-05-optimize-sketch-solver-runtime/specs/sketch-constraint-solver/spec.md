## ADDED Requirements

### Requirement: Sketch solve contract SHALL decouple solving from region extraction
The sketch solver contract SHALL allow callers to solve sketch geometry without deriving regions as mandatory work, and SHALL expose region extraction as an explicit operation or caller-selected solve option.

#### Scenario: Caller requests solved geometry only
- **WHEN** a caller submits a sketch solve request without requesting region extraction
- **THEN** the response returns solved status, solved geometry, constraint statuses, dimension statuses, and solve diagnostics
- **AND** the response does not derive or require derived region records

#### Scenario: Caller explicitly requests regions
- **WHEN** a caller requests region extraction for a solved sketch basis
- **THEN** the solver or region-extraction boundary derives regions from the requested solved snapshot and authored definition
- **AND** region diagnostics are returned with the region extraction result rather than hidden inside an unrelated solve response

### Requirement: Sketch solver SHALL expose explicit interactive solve lifecycle
The sketch solver contract SHALL expose an explicit interactive solve lifecycle for drag-style edits instead of relying on a stateless drag target plus advisory incremental hints.

#### Scenario: Interactive solve session starts
- **WHEN** the editor begins a constrained sketch drag for a supported sketch point or handle
- **THEN** the solver creates or reuses a compatible compiled solve basis and returns an interactive session that can be updated by subsequent drag moves

#### Scenario: Interactive solve session updates
- **WHEN** the editor submits a new drag target for an active interactive solve session
- **THEN** the solver updates the session from its previous numeric state and returns the accepted solved geometry or a machine-readable blocked result

#### Scenario: Interactive solve session ends
- **WHEN** the editor ends or cancels the drag lifecycle
- **THEN** the solver finalizes or disposes the interactive session
- **AND** no later drag update for that session is applied to the sketch draft

### Requirement: Solver incremental contract SHALL replace advisory edit hints
The solver contract SHALL replace advisory incremental edit hints with deterministic compatibility and invalidation behavior for compiled programs and interactive sessions.

#### Scenario: Compatible numeric edit occurs
- **WHEN** only numeric values compatible with the existing compiled basis change between interactive solve updates
- **THEN** the solver reports the session as reusable and continues from the existing compiled program

#### Scenario: Incompatible graph edit occurs
- **WHEN** the authored sketch graph or projected reference basis changes in a way that invalidates compiled variables or equations
- **THEN** the solver reports the prior compiled basis as incompatible
- **AND** callers must start a new compiled solve basis before reusing incremental behavior

### Requirement: Solver diagnostics SHALL remain explicit during optimized solves
Optimized full and interactive solve paths SHALL preserve machine-readable diagnostics for invalid input, missing projected references, inconsistent constraints, blocked drag targets, stale sessions, and non-convergent solves.

#### Scenario: Optimized solve cannot converge
- **WHEN** a full or interactive optimized solve cannot satisfy the authored system within tolerance
- **THEN** the solver returns a failed, partially solved, blocked, unsatisfied, or non-convergent machine-readable result as appropriate
- **AND** it does not commit invalid solved geometry as if it were satisfied

#### Scenario: Projected reference is missing
- **WHEN** an optimized solve requires projected reference geometry that is absent or invalid for the active basis
- **THEN** the solver reports an explicit diagnostic for the missing or invalid projected reference
- **AND** it does not use stale cached projected coordinates as a fallback

### Requirement: Solver benchmarks SHALL cover interactive incremental performance
The repository SHALL benchmark representative full and interactive sketch solve paths so solver changes can be evaluated against common constraint counts and drag behavior.

#### Scenario: Developer runs incremental solver benchmark
- **WHEN** the solver benchmark is executed
- **THEN** it reports timing for full solves and interactive drag-frame solves on representative 10-constraint, 50-constraint, and 150-constraint fixtures

#### Scenario: Benchmark includes independent components
- **WHEN** the benchmark includes a sketch fixture with multiple independent connected solver components
- **THEN** it reports drag-frame timing for solving one affected component without solving unrelated components
