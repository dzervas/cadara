## 1. Replace the persisted image contract

- [ ] 1.1 Add dedicated `referenceImage` operation contracts and runtime validation for inline base64 image payloads and placement state.
- [ ] 1.2 Thread `referenceImage` operation persistence through sketch save, reopen, and history replay flows.
- [ ] 1.3 Remove the current raster-image dependence on embedded-binary asset indirection from active reference-image flows.

## 2. Add sketch-mode image authoring

- [ ] 2.1 Add the sketch-mode `Import Image` tool and direct file-selection flow that commits a `referenceImage` operation into the active sketch.
- [ ] 2.2 Implement default centered placement and multi-image insertion behavior without creating local sketch points, entities, or constraints.
- [ ] 2.3 Keep the generic part-mode import session free of raster reference-image creation after the new sketch-owned flow lands.

## 3. Render and manage committed reference images

- [ ] 3.1 Add committed reference-image renderables and pick targets derived directly from operation-owned state.
- [ ] 3.2 Implement selection, deletion, and history behavior for independent `referenceImage` operations in one sketch.
- [ ] 3.3 Ensure normal sketch solving and local-geometry editing ignore committed reference-image operations entirely.

## 4. Remove the legacy image system and prove the boundary

- [ ] 4.1 Delete the old image import provider, image entity, image pin placement, and image-specific sketch-constraint code paths.
- [ ] 4.2 Update runtime-schema tests, sketch-session tests, and fixtures to use only the new `referenceImage` operation path.
- [ ] 4.3 Add regression coverage proving imported images persist inline, render as committed operations, and do not materialize as local sketch geometry.
