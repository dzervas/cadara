## 1. Regression Coverage

- [x] 1.1 Move the existing topological naming limitation coverage from `ignored-tests/occ-kernel-limitations/topological-naming.limit.spec.ts` into a default `bun run test` path.
- [x] 1.2 Add a failing test that verifies an untouched bottom face remains live after sequential joined boss/rib booleans.
- [x] 1.3 Add a failing test that verifies a downstream plane can resolve a pre-join planar face reference.
- [x] 1.4 Add a failing test that verifies a downstream fillet can resolve a pre-simplification same-domain edge reference.
- [x] 1.5 Add a failing test that reloads or rebuilds authored feature history and verifies stable face/edge refs still resolve after the rebuild.
- [x] 1.6 Add a failing test that verifies a subtract or shell operation reports a deleted-topology diagnostic for a removed referenced face.
- [x] 1.7 Add a failing test that verifies a split or equivalent operation reports an ambiguous-topology diagnostic when one old face or edge has multiple plausible successors.
- [x] 1.8 Add a failing test that verifies consumed Combine tool-body topology is invalidated rather than rebound to target-body topology.

## 2. OCC Naming Infrastructure

- [x] 2.1 Add an internal OCC topology naming module that owns a `TDocStd_Document`, body labels, topology labels, and mappings between public durable refs and TNaming labels.
- [x] 2.2 Seed OCAF/TNaming names for newly created bodies and their face, edge, and vertex topology without exposing labels in public snapshots.
- [x] 2.3 Implement unique-successor resolution for public topology refs using `TNaming_Tool`, `TNaming_Selector`, and OCC shape-history data.
- [x] 2.4 Implement deleted, missing, and ambiguous topology invalidation records with machine-readable reasons.
- [x] 2.5 Add focused unit coverage for the naming module's label creation, successor resolution, fresh-id assignment, and ambiguity handling.

## 3. Feature History Integration

- [x] 3.1 Record boolean evolution into the naming layer for `BRepAlgoAPI_Fuse`, `BRepAlgoAPI_Cut`, and `BRepAlgoAPI_Common`.
- [x] 3.2 Include `SimplifyResult(...)` and `ShapeUpgrade_UnifySameDomain` refinement history in the naming pipeline before final body topology is tracked.
- [x] 3.3 Record topology evolution for fillet and chamfer replacements.
- [x] 3.4 Record topology evolution for shell, thicken, transform, split, delete-solid, and Combine advanced features.
- [x] 3.5 Handle sequential multi-body booleans by composing each operation's naming history before replacing the preserved target body.

## 4. Reference State Reconciliation

- [x] 4.1 Replace token-only replacement enumeration with naming-aware topology reconciliation in `trackReplacementSolidBody` or its successor.
- [x] 4.2 Preserve previous public face, edge, and vertex ids when naming resolves exactly one final subshape successor.
- [x] 4.3 Assign fresh public ids to new topology that is not claimed by a preserved predecessor.
- [x] 4.4 Keep deleted and ambiguous old refs in `invalidatedReferencesByKey` with precise invalidation details.
- [x] 4.5 Ensure `requireFace`, `requireEdge`, and downstream feature execution resolve stable public refs to current OCC subshapes.

## 5. Verification And Cleanup

- [x] 5.1 Remove or replace the ignored limitation test duplicate once equivalent default-suite tests exist.
- [x] 5.2 Run `bun run test` and confirm promoted topology naming tests pass.
- [x] 5.3 Run `bun run lint`.
- [x] 5.4 Run `bun run build`.
- [x] 5.5 Review snapshots and render bindings to confirm no OCAF/TNaming internals leak through public contracts.
