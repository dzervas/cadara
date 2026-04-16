## 1. Modeling Contract

- [x] 1.1 Replace extrude and revolve singular `parameters.profile` fields with non-empty `parameters.profiles` arrays in `src/contracts/modeling/schema.ts`
- [x] 1.2 Remove singular profile/depth/direction transitional aliases that conflict with the new breaking profile contract
- [x] 1.3 Update schema-version comments and public contract barrel exports so the profile collection contract is documented as authoritative
- [x] 1.4 Add or update contract validation helpers to reject missing `profiles`, empty profile arrays, whole-sketch profile seeds, invalid profile reference shapes, and duplicate profile references according to the chosen rule

## 2. Durable Examples and Operation History

- [x] 2.1 Update modeling contract fixtures, examples, and unit tests to use `profiles` for extrude and revolve definitions
- [x] 2.2 Update modeling operation-history payload types, fixture entries, and validation tests so preview/replay examples reject legacy singular profile payloads
- [x] 2.3 Add regression coverage for one-profile and multi-profile extrude and revolve payloads at the contract boundary

## 3. Feature Authoring and Form Binding

- [x] 3.1 Update extrude draft creation, hydration, patching, primary target selection, preview labels, missing-input diagnostics, and definition building to use profile arrays
- [x] 3.2 Update revolve draft creation, hydration, patching, primary target selection, preview labels, missing-input diagnostics, and definition building to use profile arrays while keeping axis selection separate
- [x] 3.3 Update extrude and revolve form schemas to bind profile picker fields to collection draft values with `allowsMultiple: true` where feature semantics allow multi-profile selection
- [x] 3.4 Confirm fillet edge targets and shell removable-face targets remain collection-shaped and add consistency tests if existing coverage is missing

## 4. Modeling Service and OCC Adapter

- [x] 4.1 Update modeling service request handling, preview derivation, create/update paths, and snapshot hydration to preserve ordered profile arrays
- [x] 4.2 Update OCC adapter extrude handling to iterate or otherwise process submitted profile arrays and return explicit diagnostics for unsupported profile groups
- [x] 4.3 Update OCC adapter revolve handling to process submitted profile arrays with the existing axis contract and return explicit diagnostics for unsupported profile groups
- [x] 4.4 Add adapter tests for empty, invalid, single-profile, duplicate-profile, and multi-profile inputs for extrude and revolve

## 5. Verification

- [x] 5.1 Run focused Bun tests for modeling contracts, operation history, feature authoring, and OCC adapter profile handling
- [x] 5.2 Run the project typecheck with the repo's Bun script
- [x] 5.3 Re-run or update the `improve-feature-form-selection` verification path that depends on extrude and revolve profile picker collection semantics
