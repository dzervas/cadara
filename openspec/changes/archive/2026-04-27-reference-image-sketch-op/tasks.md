## 1. Replace the persisted image contract

- [x] 1.1 Add dedicated `referenceImage` operation contracts and runtime validation for inline base64 image payloads and placement state.
- [x] 1.2 Thread `referenceImage` operation persistence through sketch save, reopen, and history replay flows.
- [x] 1.3 Remove the current raster-image dependence on embedded-binary asset indirection from active reference-image flows.

## 2. Add sketch-mode image authoring

- [x] 2.1 Add the sketch-mode `Import Image` tool and direct file-selection flow that commits a `referenceImage` operation into the active sketch.
- [x] 2.2 Implement default centered placement and multi-image insertion behavior without creating local sketch points, entities, or constraints.
- [x] 2.3 Keep the generic part-mode import session free of raster reference-image creation after the new sketch-owned flow lands.

## 3. Render and manage committed reference images

- [x] 3.1 Add committed reference-image renderables and pick targets derived directly from operation-owned state.
- [x] 3.2 Implement selection, deletion, and history behavior for independent `referenceImage` operations in one sketch.
- [x] 3.3 Ensure normal sketch solving and local-geometry editing ignore committed reference-image operations entirely.

## 4. Remove the legacy image system and prove the boundary

- [x] 4.1 Delete the old image import provider, image entity, image pin placement, and image-specific sketch-constraint code paths.
- [x] 4.2 Update runtime-schema tests, sketch-session tests, and fixtures to use only the new `referenceImage` operation path.
- [x] 4.3 Add regression coverage proving imported images persist inline, render as committed operations, and do not materialize as local sketch geometry.
