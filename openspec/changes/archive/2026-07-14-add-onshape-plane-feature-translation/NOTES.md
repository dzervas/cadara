# Implementation Notes

## Verification status (automated)

Ran locally (podman container not reachable from this environment; used the
repo's bundled Bun/Node toolchain directly):

- `eslint .` — pass
- `tsc -b tsconfig.app.json` — pass
- `vite build` — pass
- Logic lane (`src/contracts src/core src/domain src/application src/cli
  src/infrastructure/{modeling,persistence,workers}`) — 360 passed, 0 failed
- UI lane + `test/static` — 147 passed, 0 failed

No pre-existing failures observed in the non-e2e lanes after this change.

### Fixtures updated (relied on the old "mock plane unsupported" behavior)

- `mock-kernel-adapter.spec.ts`: the old
  `testUnsupportedFeatureDefinitionsAreRejectedByMock` asserted the mock rejected
  all plane creation. The mock now materializes plane features, so it was
  repurposed to `testCoplanarPlaneCreationIsAcceptedByMock` and a new
  `testExplicitFramePlaneCreationAndSketchSupportResolution` was added.
- `modeling-service-document-repository.spec.ts` and
  `modeling-history-persistence.spec.ts`: their "rejected mutation" fixture used
  a coplanar plane on a live seed construction (now accepted). Repointed to an
  unresolvable construction id so the rejected-mutation-does-not-persist
  assertions still hold.
- `provider.spec.ts`: the face-only sketch (no cPlane producer) no longer takes
  the deleted phantom-support path; it now resolves through the probe onto a
  real face reference (`sketch-on-probed-face`). Tests updated accordingly and
  new cPlane-translation coverage added.

## Post-smoke fix: review path was missing the history probe

First real import of `9841` still baked the whole studio (document had a single
`bakedBody`; "Incline" was not a plane). Root cause: `activateCapturedFrameTranslation`
and `activateProbeBackedPlanning` are gated on `capabilities.history`, and the
**review** capability site (`use-workbench-part-import.ts`) built capabilities
without a history probe — only the **prepare/commit** site (`document-owner.ts`)
wired one. Since `reviewStudio` assigns tiers, translation never ran, so the
cPlane and its sketch stayed baked.

Confirmed the translation logic is correct by running the real bundle through
`provider.review` with a stub probe: `Incline` → `plane`
(`plane-from-captured-frame`), `Screen Outline` → `sketch`
(`sketch-on-translated-plane`).

Fix: the review capability site now wires `createBrowserOccImportHistoryProbe`
(new injectable `createImportHistoryProbe` dep, defaulting to the browser OCC
probe). Added a regression assertion in `workbench-part-import-toolbar.spec.ts`
that review builds capabilities with a history probe. Re-run the `9841` smoke to
confirm the per-tier delta now lands.

## Remaining (require operator / environment)

- **5.1 Manual smoke on real OCC** with
  `9841e486906fa2ce62d74d8e.onshape-capture.json`: confirm "Incline" imports as a
  live `plane` feature and "Screen Outline" commits parametrically on it. Not
  runnable headless here — needs the workbench + OpenCascade runtime. Expected
  per-tier delta: the `Incline` cPlane moves `baked → parametric`
  (`plane-from-captured-frame`) and `Screen Outline` moves `baked → parametric`
  (`sketch-on-translated-plane`); previously both baked (the sketch aborted the
  import on real OCC via the phantom `construction_import_captured_JGC` support).
- **5.2 `bun run test:e2e`**: the Playwright lane is currently broken in this
  environment; run it (and the full `bun run test:all`) in the container to
  confirm no regressions.
