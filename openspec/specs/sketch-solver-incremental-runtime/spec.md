# sketch-solver-incremental-runtime Specification

## Purpose
TBD - created by archiving change optimize-sketch-solver-runtime. Update Purpose after archive.
## Requirements
### Requirement: Sketch solver SHALL compile reusable solve programs
The system SHALL compile compatible sketch definitions into reusable solve programs that separate structural solver data from mutable numeric solve state.

#### Scenario: Compile compatible sketch structure
- **WHEN** the solver receives a valid sketch definition, projected reference set, tolerance policy, and solve strategy for compilation
- **THEN** it produces a compiled solve program containing stable variable ordering, equation metadata, dependency graph data, and component partitions
- **AND** the compiled program can create solve sessions without rebuilding that structural data

#### Scenario: Reuse compiled structure for repeated solves
- **WHEN** two solve requests use the same compiled-compatible sketch graph and only numeric point or drag target values have changed
- **THEN** the solver reuses the compiled structural program
- **AND** only mutable numeric state and affected result buffers are updated for the repeated solve

### Requirement: Interactive sketch solves SHALL warm-start from prior solved values
The system SHALL seed interactive solve sessions from the previous solved snapshot or previous interactive frame when compatible values are available.

#### Scenario: Start interactive solve from solved snapshot
- **WHEN** an interactive solve session starts with a prior solved snapshot whose point, entity, and auxiliary variable identities match the compiled program
- **THEN** the session initializes its numeric values from that solved snapshot instead of authored initial positions alone

#### Scenario: Continue interactive solve from previous frame
- **WHEN** an interactive drag move follows an accepted interactive solve frame in the same session
- **THEN** the next solve uses the prior frame's solved numeric values as its initial values
- **AND** unchanged compatible auxiliary variables retain their previous solved values

### Requirement: Interactive sketch solves SHALL solve only affected components when possible
The system SHALL identify the solver component affected by an interactive drag target and SHALL avoid solving unrelated components when the compiled dependency graph proves they are independent.

#### Scenario: Drag affects one independent component
- **WHEN** a sketch contains two independent solver components and the user drags a point in one component
- **THEN** the interactive solve updates only variables and statuses for the affected component
- **AND** solved values for the unaffected component remain equal to their previous session values

#### Scenario: Drag target is coupled through constraints
- **WHEN** a drag target participates in constraints, dimensions, entities, or projected-reference equations that connect multiple variable groups
- **THEN** the affected component includes every variable and equation reachable through the compiled equation-variable graph

### Requirement: Compiled solve sessions SHALL declare deterministic invalidation
The system SHALL invalidate compiled solve programs or interactive sessions when their structural assumptions no longer match the requested solve basis.

#### Scenario: Structural sketch graph changes
- **WHEN** authored points, entities, constraints, dimensions, derived relationships, projected reference identities, tolerance policy, or solve strategy change in a way that alters variables or equations
- **THEN** the existing compiled solve program is marked incompatible for that basis
- **AND** the solver requires a new compiled program before reusing structural data

#### Scenario: Stale interactive session is used
- **WHEN** a caller attempts to update an interactive solve session after its compiled basis has been invalidated or disposed
- **THEN** the solver rejects the update with a machine-readable stale-session diagnostic or contract error
- **AND** it does not apply the update to authored sketch geometry

### Requirement: Solver hot paths SHALL avoid avoidable per-frame allocation
The system SHALL keep interactive solve hot paths flat and reusable by avoiding structural map, closure, matrix, status, and array rebuilding during compatible drag-frame updates.

#### Scenario: Drag move updates numeric state
- **WHEN** an interactive drag move is evaluated against a compatible compiled solve session
- **THEN** the solver updates drag target values, numeric buffers, per-equation residuals, and affected result records in place where practical
- **AND** it does not rebuild the full scalar system for the entire sketch on that frame

#### Scenario: Full snapshot is requested
- **WHEN** a caller requests a full solved sketch snapshot from an interactive session
- **THEN** the solver may materialize complete snapshot arrays and statuses for the response
- **AND** the materialization does not change the reusable compiled program.

