## Why

The codebase currently hand-writes a large runtime validation layer across the frontend-facing modeling boundary, solver boundary, and persisted operation-history payloads. That duplicates contract structure in multiple places, inflates maintenance cost, and produces inconsistent error handling even though the same payload families are already versioned and strongly typed.

## What Changes

- Add Zod as the runtime validation library for frontend-facing modeling, sketch, solver, render-export, and persisted operation-history payloads.
- Introduce shared schema modules for transport and persistence payloads so runtime validation is defined once instead of re-implemented through ad hoc `assert*` and `normalize*` functions.
- Migrate the highest-code-volume validation surfaces first:
  - modeling-service response normalization for snapshots, render exports, sketch payloads, and feature payloads
  - operation-history payload validation and persistence loading
  - modeling and solver request-envelope validation where current code manually checks `contractVersion`, `schemaVersion`, and required top-level fields
- Preserve internal domain and geometry invariants as code-level assertions where Zod would not meaningfully reduce code or improve clarity.
- Add explicit, schema-owned validation messages where callers or persisted-data readers need actionable errors, including version mismatches, invalid persisted history, required top-level payload fields, non-empty collections, and positive numeric constraints.

## Capabilities

### New Capabilities
- `runtime-contract-validation`: Defines schema-owned runtime validation for externally sourced and persisted payloads, including explicit validation failures and actionable error messages at contract boundaries.

### Modified Capabilities
- `durable-modeling-contract`: Modeling contract payloads now require schema-backed runtime validation and explicit rejection behavior for malformed or version-mismatched payloads.
- `modeling-operation-history`: Persisted operation-history validation now uses schema-backed runtime validation with explicit error messages for invalid JSON, version mismatches, and invalid operation payloads.

## Impact

- Affected code includes `src/domain/modeling/modeling-service.ts`, `src/contracts/modeling/operation-history.ts`, `src/domain/modeling/modeling-history-persistence.ts`, `src/domain/modeling/opencascade-kernel-adapter.ts`, `src/domain/modeling/mock-kernel-adapter.ts`, `src/domain/solver/sketch-constraint-solver-adapter.ts`, `src/domain/solver/mock-sketch-solver-adapter.ts`, and the contract modules under `src/contracts/**`.
- Adds a new dependency on `zod`.
- Expected to remove a substantial amount of duplicated runtime parsing and validation code, especially in `modeling-service.ts`.
- Does not change CAD kernel semantics, editor interaction semantics, or internal OCC/math invariant enforcement.
