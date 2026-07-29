## Why

Extrude and revolve currently only produce solid bodies from closed profile regions. Surface modeling needs the same profile workflows to produce sheet bodies from closed regions or open sketch-curve chains, while keeping invalid boolean states impossible in persisted contracts. Adding first-class sheet bodies also gives thicken a real surface-to-solid path instead of the current planar prism approximation.

Assumptions: no legacy data must hydrate; existing fixtures and examples can be rewritten to the new contract shapes; sweep and loft surface modes remain out of scope.

## What Changes

- **BREAKING**: Reshape `ExtrudeFeatureParameters` and `RevolveFeatureParameters` into `resultBodyType: "solid" | "surface"` discriminated unions.
- **BREAKING**: Solid variants keep today's exact fields and semantics plus `resultBodyType: "solid"`; surface variants omit `operation` and `booleanScope` entirely.
- Allow surface extrude/revolve profile refs to include durable open sketch-curve entities, one entity per ref, grouped into connected wires by the kernel.
- Add first-class body kind `solid | sheet` to tracked OCC bodies and persisted `BodySnapshotRecord` records, with kind-aware object tree labels.
- Execute surface extrude/revolve as wire sweeps that produce exactly one sheet body, with sheet-specific topology source keys for boundary first/last edges.
- Rewrite thicken to accept durable face targets or one sheet-body target and produce solids using OCC thick-solid/offset APIs.
- Require solid-only features and boolean target/tool paths to reject sheet bodies with explicit unsupported diagnostics.
- Add generic authoring schema support for the Solid/Surface enum toggle in extrude and revolve without feature-specific inspector branching.

## Capabilities

### New Capabilities

- `surface-body-substrate`: Adds first-class sheet-body tracking, snapshots, presentation, shape-agnostic render/export parity, solid-only rejection rules, and sheet-specific topology provenance.

### Modified Capabilities

- `profile-based-feature-contract`: Adds result-body discriminated unions, surface-only open-curve profile refs, and surface-mode validation rules for extrude and revolve.
- `occ-basic-feature-operations`: Adds OCC execution rules for surface extrude/revolve and explicit diagnostics for draft or result-shape mismatches.
- `thicken-feature`: Rewrites thicken around face or sheet-body inputs and OCC thick-solid/offset APIs.

## Impact

- Affects `src/contracts/modeling/schema.ts`, runtime-schema Typia validators, schema versions in `src/contracts/shared/versioning.ts`, contract fixtures/examples, operation history validation, snapshot hydration, feature authoring definitions, generic form schemas, OCC body tracking, topology naming, object tree presentation, and adapter tests.
- Existing tessellation, picking, viewport double-sided materials, and STEP export remain shape-agnostic and should need only kind propagation and regression coverage.
- Onshape importer currently skips `bodyType: SURFACE` extrudes; importing Onshape surface extrudes is a follow-up and out of scope for this change.
