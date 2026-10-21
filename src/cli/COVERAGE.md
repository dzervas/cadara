# Browserless release coverage

This is an operation inventory, not a promise that every registered tool or
arbitrary combination of parameters is executable. The closed semantic contract
is authoritative for inputs; discovery at the current basis is authoritative for
references and capabilities. See README for the bounded variants of each row.
Every operation below has existing public application and/or actual Bun recipe
coverage. Family qualification is retained from tickets 11–36; ticket 38 reruns
the foundation and representative cross-family/failure/isolation seams, not the
entire historical test union.
Operation discovery (`--help`, `--schema`) and structured preflight/selection
errors are qualified by `src/cli/recipe-discovery.spec.ts`.

| Surface | Exact operations | Qualification seams (repository paths) / boundaries |
| --- | --- | --- |
| Documents | `document.create`, `document.inspect`, `document.rename`, `document.open`, `document.save` | `src/cli/native-document-files.spec.ts`, `src/application/semantic/workflow.spec.ts`; current native JSON, retained assets, observed write/sync/close; no cross-process undo |
| Sketch context | `sketch.begin`, `sketch.open`, `sketch.inspect`, `sketch.publish`, `sketch.discard` | `src/cli/sketch-recipes.spec.ts`, `src/cli/workflow-recipes.spec.ts`; current private draft, explicit publish/discard |
| Primitives | `sketch.author` | `src/cli/round-recipes.spec.ts`, `src/cli/advanced-recipes.spec.ts`; point, line, rectangle/center/aligned rectangle, circle/three-point circle, three-point/center/tangent arc, six-sided inscribed/circumscribed polygon, ellipse/elliptical arc, conic, cubic Bézier/control-point spline, ordinary spline, profile text. Advanced authoring is NOT a promise of consumable regions |
| Requirements | `sketch.requirement.add`, `sketch.requirement.remove`, `sketch.dimension.add`, `sketch.dimension.update`, `sketch.dimension.reference` | `src/cli/requirement-recipes.spec.ts`, `src/cli/dimension-recipes.spec.ts`; shared constraint/dimension descriptors, driving/reference mode, explicit invalid intent and solve diagnostics |
| Geometry editing | `sketch.geometry.update`, `sketch.geometry.delete`, `sketch.construction.set`, `sketch.label.set` | `src/cli/sketch-move-recipes.spec.ts`, `src/cli/sketch-intersection-recipes.spec.ts`; point/translate/radius/tangent/merge; exact trim/split/line-extend only, not arbitrary clicked segments |
| Corners / slots | `sketch.geometry.build` | `src/cli/sketch-construction-recipes.spec.ts`; fillet/chamfer adjacent lines; line, arc or closed line-chain slot, not arbitrary curves |
| Derived sketch operations | `sketch.derivation.create` | `src/cli/sketch-derivation-recipes.spec.ts`; supported linear/circular pattern and transform, production derivation gates |
| Offsets | `sketch.offset.create`, `sketch.offset.remove` | `src/cli/sketch-offset-recipes.spec.ts`; supported durable paths and explicit side, no arbitrary offset translator |
| Reciprocal mirrors | `sketch.mirror.create`, `sketch.mirror.remove`, `sketch.mirror.repair` | `src/cli/sketch-mirror-recipes.spec.ts`; owned axis/original references, invalid repair remains diagnostic, not a copied-geometry shortcut |
| Supports / projection | `sketch.support.reassign`, `sketch.reference.add` | `src/cli/sketch-support-recipes.spec.ts`; construction/planar-face supports and production projected-reference eligibility |
| Style / raster | `sketch.style.patch`, `sketch.image.add`, `sketch.image.update`, `sketch.image.replace`, `sketch.image.remove` | `src/cli/sketch-style-image-recipes.spec.ts`; explicit style fields, retained raster bytes/settings, not rendering or vectorization |
| Variables | `variable.add`, `variable.update` | `src/cli/variable-recipes.spec.ts`; shared numeric/boolean expression resolver, dependency errors, no general expression interpreter in CLI |
| Authored history | `history.inspect`, `history.undo`, `history.redo` | `src/cli/history-recipes.spec.ts`, `src/cli/workflow-recipes.spec.ts`; active editing owner only; compensating edits, not restoration of old revision IDs |
| Feature lifecycle | `feature.suppression.set`, `feature.reorder`, `feature.delete`, `body.rename`, `body.color.set`, `target.delete`, `timeline.cursor.set`, `timeline.reorder` | `src/cli/lifecycle-recipes.spec.ts`; production dependency/rollback gates; target deletion is not raw document patching |
| Extrusion | `extrude.create`, `extrude.update` | `src/cli/extrusion-recipes.spec.ts`, `src/cli/extrusion-variant-recipes.spec.ts`; solid/sheet, bounded end/start/direction/boolean scope variants described in README |
| Revolution | `revolve.create`, `revolve.update` | `src/cli/revolve-recipes.spec.ts`; supported solid/sheet profiles and explicit eligible axis, angles in radians and production booleans |
| Construction | `plane.create`, `plane.update` | `src/cli/plane-recipes.spec.ts`; supported canonical plane kinds/reference cardinalities only |
| Edge treatment | `fillet.create`, `fillet.update`, `chamfer.create`, `chamfer.update` | `src/cli/edge-treatment-recipes.spec.ts`; eligible native solid edges, bounded production options, invalid geometry is not fulfillment |
| Shell / thicken | `shell.create`, `shell.update`, `thicken.create`, `thicken.update` | `src/cli/shell-thicken-recipes.spec.ts`; native supported faces/sheets/directions and booleans; no arbitrary repair |
| Holes | `hole.create`, `hole.update` | `src/cli/hole-recipes.spec.ts`; simple/counterbore/countersink, explicit positions/support/depth, no inferred placement |
| Sweeps | `sweep.create`, `sweep.update` | `src/cli/sweep-recipes.spec.ts`; explicit supported paths/sections; advanced two-section endpoint loft is NOT continuous helical transport. `keepProfileOrientation` inert native variant is refused (local 39) |
| Lofts | `loft.create`, `loft.update` | `src/cli/loft-recipes.spec.ts`; supported ordered solid/sheet sections, ruled/closed variants; inert derivative/magnitude/connection controls refused (local 40) |
| Booleans / removal | `combine.create`, `combine.update`, `split.create`, `split.update`, `deleteSolid.create`, `deleteSolid.update` | `src/cli/body-boolean-recipes.spec.ts`; combine union/subtract/intersect, eligible split tools, exact body removal; missing split/delete sources are nonrepairable production refusals |
| Body copies / transforms | `mirror.create`, `mirror.update`, `transform.create`, `transform.update`, `linearPattern.create`, `linearPattern.update`, `circularPattern.create`, `circularPattern.update` | `src/cli/body-copy-recipes.spec.ts`; body-only supported copies, bounded mirror add scope, in-place translation/rotation, counts include seed. No face/feature patterns or centered body patterns |
| Feature replay | `featureReplay.create`, `featureReplay.update` | `src/cli/feature-replay-recipes.spec.ts`; ordered solid extrude join/cut exact-target operations and earlier nested replay, construction direction/plane only; not generic feature or body pattern |
| Geometry exports | `export.step`, `export.stl`, `export.3mf` | `src/cli/step-recipes.spec.ts`, `src/cli/export-recipes.spec.ts`; body targets, STEP AP203/AP214/AP242 millimeters; STL binary/ascii and positive finite native mesh tolerances; 3MF millimeters/metadata toggle; unchanged provider algorithms |
| Sketch exports | `export.svg`, `export.dxf` | `src/cli/export-recipes.spec.ts`, `src/application/semantic/geometry-export.spec.ts`; committed sketch only; unsupported entities warn/skip, empty output refuses; DXF approximations and SVG region styling remain provider-defined |

## Runnable examples

From any writable directory with Bun installed:

```sh
bun /absolute/path/to/cadara-cli/main.js document recipe /absolute/path/to/cadara-cli/examples/plate.json
bun /absolute/path/to/cadara-cli/main.js document recipe /absolute/path/to/cadara-cli/examples/sketch.json
bun /absolute/path/to/cadara-cli/main.js document recipe /absolute/path/to/cadara-cli/examples/scoped-profiles.json
```

`plate.json` authors a 20 × 10 × 7 mm solid, edits depth to 9, undoes/redoes,
restores depth to 7, inspects history, saves `plate.cadara` and inspects the model.
`sketch.json` authors and publishes a radius-5 circle, saves `sketch.cadara`,
reopens it and inspects the fresh context. `scoped-profiles.json` extrudes the
`Outer region` of an xy and a yz sketch selected by owning sketch
(`src/cli/sketch-owner-recipes.spec.ts`). Output paths are relative to the
caller's working directory. These examples execute during the extracted-package
workflow test. The README gives the remaining bounded-family input recipes;
family-specific executable examples/assertions live at the exact test paths in
the table, not in a second release-only modeling harness.

References are exact and unique within the named result alias (and owning
sketch, when qualified). Examples use labels whose uniqueness follows from their
single-profile/single-feature setup or sketch qualification;
for your own documents discover references, never guess generated IDs or take
the first face/body. Refresh the basis after each change.

## Release truth and exclusions

- Source and extracted package use the SAME custom production kernel, mandatory
  native capability probes, semantic validator/session, shared preparation,
  service, native query/geometry and export providers. No browser globals,
  renderer, daemon, port, stock-kernel fallback or geometry certification shim.
- Exactly three runtime files: `main.js`, `occ/cadara-occ.js`,
  `occ/cadara-occ.wasm`. JS dependencies and generated Typia validators are
  bundled at build time. The reachable memory repository does not import
  Automerge's WASM runtime; no external Automerge asset is needed. Do not ship
  source preloads, node_modules or a cwd-relative tsconfig.
- Closed input errors are exit 2 with empty stdout; command failures exit 1
  with correlated completed-prefix results and unexecuted suffix; success is
  exit 0. Awaited cleanup and observed file bytes are distinct from committed
  authored state. Stale bases, ambiguous/missing references, invalid profiles,
  missing native assets and write/sync/close failures never certify last-good
  or display geometry. Explicit `author-invalid` is not geometry fulfillment.
- Ticket 37 / Onshape importer changes are deferred, not qualified. Existing
  `onshape capture` behavior is preserved; the inherited JHo apply failure
  remains unresolved. No inferred creator/owner provenance from geometry.
- Historical ticket-28 mirror test reached its original 180-second timeout on
  both integration and unchanged ticket-27 baseline; cause is unproven.
  The interrupted later ticket-29 aggregate has no valid exit. Neither is
  retrospectively greened by representative release checks.
- No aggregate/UI/browser/E2E acceptance is claimed by this release's targeted
  logic/static runs. Existing pointer/browser suites remain separate and are
  not replaced by CLI tests. No cross-session undo, arbitrary native repair,
  translator, rendering or new CAD capability is added.
