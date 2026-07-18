import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import { validateOnshapeCaptureBundle } from "@/contracts/import/onshape-capture-bundle";
import { readPartStudio } from "@/domain/import/onshape/bundle-reader";
import { makeWaveBBodyCaptureBundle } from "@/domain/import/onshape/wave-b-capture-fixtures";
import {
  createRollbackTopologyTimeline,
  diffRollbackTopologySnapshots,
  readRollbackTopologySnapshot,
  rollbackBodyShapeKey,
} from "@/domain/import/onshape/rollback-topology-reader";

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

test("attributes a body to every feature that introduced or reshaped it before the consumer", () => {
  const unchanged = tessellation("JHD", "face-a");
  const timeline = createRollbackTopologyTimeline({
    featureIds: ["extrude", "sketch", "chamfer", "transform", "boolean"],
    snapshots: [
      { featureId: "extrude", tessellationTolerance: 0.0001, tessellatedFaces: unchanged },
      // sketch has no snapshot (non-solid features are skipped by capture).
      { featureId: "chamfer", tessellationTolerance: 0.0001, tessellatedFaces: tessellation("JHD", "face-b") },
      { featureId: "transform", tessellationTolerance: 0.0001, tessellatedFaces: tessellation("JHD", "face-b") },
      { featureId: "boolean", tessellationTolerance: 0.0001, tessellatedFaces: tessellation("other", "face-c") },
    ],
  });

  // extrude introduced JHD, chamfer reshaped it, transform left it identical.
  expect(timeline.featuresModifyingBody("JHD", "boolean")).toEqual(["extrude", "chamfer"]);
  // Bodies born later are not attributed to earlier features; disappearance counts as a change.
  expect(timeline.featuresModifyingBody("other", "boolean")).toEqual([]);
  expect(timeline.featuresModifyingBody("JHD", "unknown-consumer")).toEqual(["extrude", "chamfer", "boolean"]);
});

test("selects the nearest available preceding snapshot and diagnoses malformed payloads", () => {
  const timeline = createRollbackTopologyTimeline({
    featureIds: ["a", "b", "c"],
    snapshots: [
      { featureId: "a", tessellationTolerance: 0.001, tessellatedFaces: {} },
      { featureId: "c", tessellationTolerance: 0.001, tessellatedFaces: tessellation("result", "face") },
      { featureId: "unknown", tessellationTolerance: 0.001, tessellatedFaces: tessellation("x", "y") },
    ],
  });
  expect(timeline.snapshotBeforeFeature("c")?.featureId).toBe("a");
  expect(timeline.snapshotBeforeFeature("c")?.diagnostics[0]?.code).toBe("rollback-tessellation-unreadable");
  expect(timeline.bodyDeltaBetweenFeatures("c", "c")).toBeNull();
  expect(timeline.diagnostics[0]?.code).toBe("rollback-feature-order-unreadable");
});

test("classifies persistent, introduced, changed, removed, and unchanged body IDs", () => {
  const before = readRollbackTopologySnapshot({
    featureId: "before",
    tessellationTolerance: 0.0001,
    tessellatedFaces: {
      bodies: [
        ...tessellation("changed", "face-a").bodies,
        ...tessellation("removed", "face-b").bodies,
        ...tessellation("unchanged", "face-c").bodies,
      ],
    },
  });
  const after = readRollbackTopologySnapshot({
    featureId: "after",
    tessellationTolerance: 0.0001,
    tessellatedFaces: {
      bodies: [
        ...tessellation("introduced", "face-d").bodies,
        ...tessellation("unchanged", "face-c").bodies,
        ...tessellation("changed", "face-a-updated").bodies,
      ],
    },
  });

  expect(diffRollbackTopologySnapshots(before, after)).toEqual({
    beforeFeatureId: "before",
    afterFeatureId: "after",
    introducedBodyDeterministicIds: ["introduced"],
    changedBodyDeterministicIds: ["changed"],
    removedBodyDeterministicIds: ["removed"],
    unchangedBodyDeterministicIds: ["unchanged"],
  });
  expect(rollbackBodyShapeKey(before.bodies[2]!)).toBe(
    rollbackBodyShapeKey(after.bodies[1]!),
  );
});

test("uses sparse consecutive rollback snapshots and refuses missing boundaries", () => {
  const bundle = makeWaveBBodyCaptureBundle("delete");
  const studio = bundle.partStudios[0]!;
  const featureIds = studio.features.features.map((feature) => feature.featureId);
  const timeline = createRollbackTopologyTimeline({
    featureIds,
    snapshots: studio.rollbackSnapshots,
  });

  expect(timeline.bodyDeltaBetweenFeatures("C", "C")).toEqual({
    beforeFeatureId: "E1",
    afterFeatureId: "C",
    introducedBodyDeterministicIds: [],
    changedBodyDeterministicIds: [],
    removedBodyDeterministicIds: ["SRC1"],
    unchangedBodyDeterministicIds: [],
  });
  expect(timeline.bodyDeltaBetweenFeatures("E1", "C")).toBeNull();
  expect(timeline.bodyDeltaBetweenFeatures("C", "missing")).toBeNull();
});

test("reports a no-change feature without inventing a body delta", () => {
  const bundle = makeWaveBBodyCaptureBundle("transform");
  const studio = bundle.partStudios[0]!;
  const timeline = createRollbackTopologyTimeline({
    featureIds: studio.features.features.map((feature) => feature.featureId),
    snapshots: studio.rollbackSnapshots,
  });

  expect(timeline.bodyDeltaBetweenFeatures("C", "C")).toMatchObject({
    introducedBodyDeterministicIds: [],
    changedBodyDeterministicIds: [],
    removedBodyDeterministicIds: [],
    unchangedBodyDeterministicIds: ["SRC1"],
  });
});

const realBundleFiles = [
  "40a51fb8fa82fd4565151114.onshape-capture.json",
  "9841e486906fa2ce62d74d8e.onshape-capture.json",
] as const;

test.skipIf(realBundleFiles.some((fileName) => !existsSync(fileName)))(
  "extracts pinned rollback body deltas from both real capture bundles",
  async () => {
    const timelines = new Map<string, ReturnType<typeof createRollbackTopologyTimeline>>();
    for (const fileName of realBundleFiles) {
      const parsed = validateOnshapeCaptureBundle(
        JSON.parse(await readFile(fileName, "utf8")),
      );
      if (!parsed.success) throw new Error(`Real capture ${fileName} must validate.`);
      const studio = parsed.data.partStudios[0]!;
      const read = readPartStudio(parsed.data, studio.elementId);
      timelines.set(fileName, createRollbackTopologyTimeline({
        featureIds: read.features.map((feature) => feature.featureId),
        snapshots: studio.rollbackSnapshots,
      }));
    }

    expect(
      timelines.get(realBundleFiles[0])?.bodyDeltaBetweenFeatures(
        "FKFj5KgXfGGLv7N_1",
        "FKFj5KgXfGGLv7N_1",
      ),
    ).toMatchObject({
      beforeFeatureId: "FO7A93XUDZDmrrZ_1",
      afterFeatureId: "FKFj5KgXfGGLv7N_1",
      changedBodyDeterministicIds: ["JHD"],
    });
    expect(
      timelines.get(realBundleFiles[1])?.bodyDeltaBetweenFeatures(
        "FQtApb0Sk3fJDW8_2",
        "FQtApb0Sk3fJDW8_2",
      ),
    ).toMatchObject({
      beforeFeatureId: "FZdJtqPHdzYIXNr_1",
      afterFeatureId: "FQtApb0Sk3fJDW8_2",
      introducedBodyDeterministicIds: ["JbD", "JbH"],
      removedBodyDeterministicIds: ["JND", "JaD"],
    });
  },
);
