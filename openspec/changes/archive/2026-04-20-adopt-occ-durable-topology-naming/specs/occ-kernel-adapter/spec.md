## ADDED Requirements

### Requirement: OCC adapter SHALL keep durable topology naming internally consistent
An OpenCascade-backed kernel adapter SHALL use internal OCC naming data to reconcile topology references across rebuilds while preserving the public modeling contract boundary.

#### Scenario: OCC naming is used during committed rebuild
- **WHEN** the adapter rebuilds committed authoring state containing body replacement operations
- **THEN** it records and resolves body topology through internal OCC naming state
- **AND** it returns contract-valid snapshots, render bindings, and diagnostics without exposing OCC naming internals

#### Scenario: Public topology ids are preserved for unique successors
- **WHEN** an old face, edge, or vertex has exactly one current successor in the final rebuilt body
- **THEN** the adapter keeps the existing public durable topology id bound to that current subshape

#### Scenario: Fresh topology receives fresh public ids
- **WHEN** a feature creates topology that is not the unique successor of any previous public topology reference
- **THEN** the adapter assigns fresh public durable topology ids that do not collide with preserved ids

#### Scenario: Reference resolution uses final refined shape
- **WHEN** a boolean result is simplified or same-domain unified before becoming the committed body shape
- **THEN** topology naming resolves references against the final stored body shape
- **AND** it does not leave durable references bound only to pre-refinement builder output
