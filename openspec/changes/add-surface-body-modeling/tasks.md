## 1. Add contract and validation changes

- [x] 1.1 Update `src/contracts/modeling/schema.ts` so `ExtrudeFeatureParameters` and `RevolveFeatureParameters` are `resultBodyType` discriminated unions, with solid variants preserving today's fields plus the discriminant and surface variants omitting `operation` and `booleanScope`.
- [x] 1.2 Add a durable open sketch-curve profile-ref variant for surface extrude/revolve, referencing `{ sketchId, entityId }` one entity per ref, and reject that variant for solid-mode payloads.
- [x] 1.3 Add `bodyKind: "solid" | "sheet"` to OCC tracked body and `BodySnapshotRecord` contracts, bump affected schema versions, and update contract examples/fixtures to the new shapes without legacy hydration.
- [x] 1.4 Add validation coverage for missing discriminants, illegal surface `operation` or `booleanScope`, open-curve refs in solid mode, invalid sketch entity refs, empty profile collections, and sheet bodies passed to solid-only contracts.
- [x] 1.5 Update operation-history and snapshot hydration coverage so solid and sheet body definitions round-trip with explicit body kind.

## 2. Add authoring and tool integration

- [x] 2.1 Update `src/core/feature-authoring/definition.ts` and draft helpers so discriminated draft variants can toggle while preserving shared fields and dropping inactive variant fields from built durable definitions.
- [x] 2.2 Update `src/core/feature-authoring/features/extrude.ts` and `src/core/feature-authoring/features/revolve.ts` to include the Solid/Surface enum field in `getFormSchema`, hide boolean fields and draft/tapered-cap-irrelevant fields in surface mode, and restore default `newBody` when switching back to solid.
- [x] 2.3 Update form-schema grouping only as needed so `src/components/layout/feature-inspector.tsx` and `feature-inspector-sections.ts` render the toggle and absent fields generically without feature-specific UI branching.
- [x] 2.4 Update object tree/snapshot presentation code, including `src/domain/modeling/occ/snapshot.ts`, so body labels are kind-aware (`Solid body` vs `Sheet body`).
- [x] 2.5 Add authoring tests for surface toggle defaults, variant switching, shared value preservation, operation removal/restoration, and open-curve profile selection acceptance only in surface mode.

## 3. Implement modeling adapter behavior

- [x] 3.1 Update OCC topology helpers in `src/domain/modeling/occ/topology.ts` and shared result tracking paths to track exactly one solid for solid variants or exactly one shell/sheet body for surface variants.
- [x] 3.2 Update `src/domain/modeling/occ/features/extrude.ts` to build closed-region solids as today and surface results from wires by skipping face construction, grouping connected sketch entities with `BRepBuilderAPI_MakeWire`, and preserving sheet boundary source keys.
- [x] 3.3 Update `src/domain/modeling/occ/features/revolve.ts` to revolve wires or closed profiles into sheet bodies for surface variants and reject unsupported construction/axis cases explicitly.
- [x] 3.4 Update boolean operation, fillet, shell, split, combine, and other solid-only adapter paths to reject sheet target/tool bodies with structured unsupported diagnostics.
- [x] 3.5 Rewrite `src/domain/modeling/occ/features/thicken.ts` to consume durable face targets or one sheet body and produce a solid through `BRepOffsetAPI_MakeThickSolid` / `BRepOffsetAPI_MakeOffsetShape`, returning unsupported diagnostics for invalid offsets or kernel failures.
- [x] 3.6 Update topology provenance for sheet extrude/revolve to use boundary first/last edge source keys instead of solid cap face keys.

## 4. Add focused automated coverage

- [x] 4.1 Add contract tests in `src/contracts/modeling/**` for discriminated extrude/revolve payloads, body kind snapshots, and fixture/example validation.
- [x] 4.2 Add feature-authoring tests in `src/domain/feature-authoring/**` for extrude/revolve surface toggles, form schema field absence, draft toggling, and draft-to-definition output.
- [x] 4.3 Add OCC adapter tests in `src/domain/modeling/**` for surface extrude from open connected sketch curves, surface revolve, sheet body tracking, sheet unsupported diagnostics in solid-only features, and thicken from a sheet body.
- [x] 4.4 Add boundary/static tests proving presentational inspector code remains generic and does not branch on extrude/revolve surface mode or import OCC modules.
- [x] 4.5 Update snapshot/export tests to prove tessellation, picking target records, and STEP export paths preserve sheet bodies shape-agnostically.

## 5. Add e2e feature-flow coverage

- [x] 5.1 Extend the shared feature workbench harness with an open-curve sketch fixture and a sheet-body-ready fixture for thicken.
- [x] 5.2 Add Playwright coverage that creates a surface extrude from an open connected sketch chain, verifies a sheet body row, and confirms boolean operation fields are absent in surface mode.
- [x] 5.3 Add Playwright coverage that creates a surface revolve, verifies sheet-body presentation, and toggles back to solid mode with default `newBody` restored.
- [x] 5.4 Add Playwright coverage that thickens a sheet body into a solid and verifies the resulting body kind and timeline state.
- [x] 5.5 Run targeted unit/integration tests and e2e feature-flow filters, then update this task list with completed verification results.

Section 5 verification results:

- `bun run test:logic` (187 files, 682 tests passed)
- `bun run test:ui` (61 files, 126 tests passed)
- `bun run test:static` (15 files, 26 tests passed)
- `bun x vitest run src/domain/feature-authoring/form-adapter.spec.ts` (passed)
- `bun x playwright test e2e/feature-flow.spec.ts -g "surface"` (2 passed)
- `bun x playwright test e2e/feature-flow.spec.ts -g "thicken"` (2 passed)
- `bun x playwright test e2e/feature-flow.spec.ts` (21 passed)

Verification run (final, whole change):
- `bun run lint` (clean)
- `bun run build` (tsc -b + vite build succeeded)
- `bun run test:logic` (187 files, 682 tests passed)
- `bun run test:ui` (61 files, 126 tests passed)
- `bun run test:static` (15 files, 26 tests passed)
- `bun x playwright test e2e/feature-flow.spec.ts` (21 passed)
- `bun x playwright test` (70 passed, full e2e suite)
- `bun x openspec validate add-surface-body-modeling --strict` (valid)

Note: a stale, pre-change Vite dev server owned by another session was listening on
port 3000, and `reuseExistingServer` made Playwright run against stale code (all e2e
failed with `resultBodyType` envelope validation errors). The e2e runs above were
executed against a freshly started dev server via
`PLAYWRIGHT_WEB_SERVER=0 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4321`.
