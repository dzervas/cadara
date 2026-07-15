import { expect, test } from "vitest";

import { createRollbackTopologyTimeline } from "@/domain/import/onshape/rollback-topology-reader";

const tessellation = (bodyId: string, faceId: string) => ({
  btType: "BTExportTessellatedFacesResponse-898",
  surplus: "ignored",
  bodies: [{
    btType: "BTExportTessellatedFacesBody-1321",
    id: bodyId,
    faces: [{
      btType: "BTExportTessellatedFacesFace-1192",
      id: faceId,
      facets: [{
        btType: "BTExportTessellatedFacesFacet-1417",
        vertices: [
          { btType: "BTVector3d-389", x: 0, y: 0, z: 0 },
          { btType: "BTVector3d-389", x: 0.01, y: 0, z: 0 },
          { btType: "BTVector3d-389", x: 0, y: 0.01, z: 0 },
        ],
        normals: [],
      }],
    }],
  }],
});

test("uses feature-list order for before/after snapshots and reads exact tessellation IDs", () => {
  const timeline = createRollbackTopologyTimeline({
    featureIds: ["extrude", "transform", "chamfer"],
    snapshots: [
      { featureId: "extrude", tessellationTolerance: 0.0001, tessellatedFaces: tessellation("JHD", "JNC"), step: "not topology identity" },
      { featureId: "transform", tessellationTolerance: 0.0001, tessellatedFaces: tessellation("JHD", "moved-face") },
      { featureId: "chamfer", tessellationTolerance: 0.0001, tessellatedFaces: tessellation("result", "post-face") },
    ],
  });

  expect(timeline.snapshotBeforeFeature("chamfer")?.featureId).toBe("transform");
  expect(timeline.snapshotAfterFeature("chamfer")?.featureId).toBe("chamfer");
  expect(timeline.snapshotBeforeFeature("transform")?.bodies[0]).toMatchObject({ id: "JHD", faces: [{ id: "JNC" }] });
});

test("selects the nearest available preceding snapshot and diagnoses malformed payloads", () => {
  const timeline = createRollbackTopologyTimeline({
    featureIds: ["a", "b", "c"],
    snapshots: [
      { featureId: "a", tessellationTolerance: 0.001, tessellatedFaces: {} },
      { featureId: "unknown", tessellationTolerance: 0.001, tessellatedFaces: tessellation("x", "y") },
    ],
  });
  expect(timeline.snapshotBeforeFeature("c")?.featureId).toBe("a");
  expect(timeline.snapshotBeforeFeature("c")?.diagnostics[0]?.code).toBe("rollback-tessellation-unreadable");
  expect(timeline.diagnostics[0]?.code).toBe("rollback-feature-order-unreadable");
});
