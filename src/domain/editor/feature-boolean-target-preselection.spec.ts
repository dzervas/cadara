import { test } from "bun:test";
import { expectTrue } from "@/testing/expect.spec";
import type {
  RenderableEntityRecord,
  RenderPoint3D,
} from "@/contracts/render/schema";
import type {
  BodyId,
  FaceId,
  PickId,
  RenderableId,
  RegionId,
  SketchId,
} from "@/contracts/shared/ids";
import {
  createFeatureEditSession,
  patchFeatureEditSession,
} from "./feature-editing";
import {
  applyFeatureBooleanTargetPreselection,
  classifyPreviewBooleanTarget,
} from "./feature-boolean-target-preselection";

test("feature boolean target preselection classifies and applies conservative defaults", () => {
  const tolerance = {
    modelingTolerance: 0.001,
    angularToleranceRadians: 0.0001,
  };

  const intersecting = classifyPreviewBooleanTarget({
    previewRenderables: [
      boxMesh("preview_intersecting", null, [0.5, 0.5, 0.5], [1.5, 1.5, 1.5]),
    ],
    bodyRenderables: [boxMesh("body_a", "body_a", [0, 0, 0], [1, 1, 1])],
    candidateBodyIds: ["body_a" as BodyId],
    settings: tolerance,
  });
  expectTrue(
    intersecting.kind === "intersects" && intersecting.bodyId === "body_a",
    "Volumetric preview/body overlap should classify as an intersection with the target body.",
  );

  const intersectingSession = applyFeatureBooleanTargetPreselection(
    createExtrudeSession(),
    intersecting,
  );
  expectTrue(
    intersectingSession.draft.operation === "cut" &&
      intersectingSession.draft.booleanScope.kind === "targetBody" &&
      intersectingSession.draft.booleanScope.bodyId === "body_a",
    "Intersecting basic-feature previews should preselect cut with the intersecting body.",
  );

  const coplanar = classifyPreviewBooleanTarget({
    previewRenderables: [
      planarFaceMesh("preview_coplanar", null, 0, [0.25, 0.25], [0.75, 0.75]),
    ],
    bodyRenderables: [
      planarFaceMesh("body_face_a", "body_a", 0, [0, 0], [1, 1]),
    ],
    candidateBodyIds: ["body_a" as BodyId],
    settings: tolerance,
  });
  expectTrue(
    coplanar.kind === "coplanarContact" && coplanar.bodyId === "body_a",
    "Coplanar preview/body face overlap should classify as coplanar contact.",
  );

  const coplanarSession = applyFeatureBooleanTargetPreselection(
    createExtrudeSession(),
    coplanar,
  );
  expectTrue(
    coplanarSession.draft.operation === "join" &&
      coplanarSession.draft.booleanScope.kind === "targetBody" &&
      coplanarSession.draft.booleanScope.bodyId === "body_a",
    "Coplanar basic-feature previews should preselect join with the contacted body.",
  );

  const noRelationship = classifyPreviewBooleanTarget({
    previewRenderables: [
      planarFaceMesh("preview_far", null, 4, [0, 0], [1, 1]),
    ],
    bodyRenderables: [
      planarFaceMesh("body_face_a", "body_a", 0, [0, 0], [1, 1]),
    ],
    candidateBodyIds: ["body_a" as BodyId],
    settings: tolerance,
  });
  const standaloneSession = applyFeatureBooleanTargetPreselection(
    createExtrudeSession(),
    noRelationship,
  );
  expectTrue(
    noRelationship.kind === "none" &&
      standaloneSession.draft.operation === "newBody" &&
      standaloneSession.draft.booleanScope.kind === "standalone",
    "No reliable relationship should keep the basic-feature draft standalone.",
  );

  const prioritized = classifyPreviewBooleanTarget({
    previewRenderables: [
      boxMesh("preview_intersecting", null, [0.5, 0.5, 0.5], [1.5, 1.5, 1.5]),
      planarFaceMesh("preview_coplanar", null, 0, [0.25, 0.25], [0.75, 0.75]),
    ],
    bodyRenderables: [
      planarFaceMesh("body_face_a", "body_a", 0, [0, 0], [1, 1]),
      boxMesh("body_b", "body_b", [1, 1, 1], [2, 2, 2]),
    ],
    candidateBodyIds: ["body_a" as BodyId, "body_b" as BodyId],
    settings: tolerance,
  });
  expectTrue(
    prioritized.kind === "intersects" && prioritized.bodyId === "body_b",
    "Reliable intersection should take precedence over coplanar contact.",
  );
});

test("feature boolean target preselection maps advanced intents and preserves manual overrides", () => {
  const advancedSession = applyFeatureBooleanTargetPreselection(
    createFeatureEditSession({
      featureType: "thicken",
      selectedTarget: {
        kind: "face",
        bodyId: "body_seed" as BodyId,
        faceId: "face_seed" as FaceId,
      },
    }),
    { kind: "coplanarContact", bodyId: "body_a" as BodyId },
  );

  expectTrue(
    advancedSession.draft.operationIntent === "add" &&
      advancedSession.draft.targetBodyTargets[0]?.bodyId === "body_a",
    "Advanced boolean-capable create features should map coplanar contact to add with a target body.",
  );

  const automatic = applyFeatureBooleanTargetPreselection(
    createExtrudeSession(),
    { kind: "intersects", bodyId: "body_a" as BodyId },
  );
  const manual = patchFeatureEditSession(automatic, {
    operation: "join",
    booleanTargetBodyId: "body_manual" as BodyId,
  });
  const preserved = applyFeatureBooleanTargetPreselection(manual, {
    kind: "intersects",
    bodyId: "body_b" as BodyId,
  });

  expectTrue(
    preserved.draft.operation === "join" &&
      preserved.draft.booleanScope.kind === "targetBody" &&
      preserved.draft.booleanScope.bodyId === "body_manual",
    "Manual operation and target changes should survive later preview classification changes.",
  );
});

function createExtrudeSession() {
  return createFeatureEditSession({
    featureType: "extrude",
    selectedTarget: {
      kind: "region",
      sketchId: "sketch_a" as SketchId,
      regionId: "region_profile" as RegionId,
    },
  });
}

function boxMesh(
  id: string,
  ownerBodyId: BodyId | null,
  min: RenderPoint3D,
  max: RenderPoint3D,
): RenderableEntityRecord {
  return meshRecord(
    id,
    ownerBodyId,
    [
      [min[0], min[1], min[2]],
      [max[0], min[1], min[2]],
      [max[0], max[1], min[2]],
      [min[0], max[1], min[2]],
      [min[0], min[1], max[2]],
      [max[0], min[1], max[2]],
      [max[0], max[1], max[2]],
      [min[0], max[1], max[2]],
    ],
    [
      [0, 1, 2],
      [0, 2, 3],
      [4, 6, 5],
      [4, 7, 6],
    ],
    "bodyFace",
  );
}

function planarFaceMesh(
  id: string,
  ownerBodyId: BodyId | null,
  z: number,
  min: readonly [number, number],
  max: readonly [number, number],
): RenderableEntityRecord {
  return meshRecord(
    id,
    ownerBodyId,
    [
      [min[0], min[1], z],
      [max[0], min[1], z],
      [max[0], max[1], z],
      [min[0], max[1], z],
    ],
    [
      [0, 1, 2],
      [0, 2, 3],
    ],
    "planarFace",
  );
}

function meshRecord(
  id: string,
  ownerBodyId: BodyId | null,
  vertices: RenderPoint3D[],
  triangles: [number, number, number][],
  semanticClass: "bodyFace" | "planarFace",
): RenderableEntityRecord {
  const targetBodyId = ownerBodyId ?? "body_preview";
  return {
    id: id as RenderableId,
    label: id,
    ownerBodyId,
    ownerFeatureId: null,
    binding: {
      pickId: `pick_${id}` as PickId,
      pickPriority: 0,
      target: {
        kind: "face",
        bodyId: targetBodyId as BodyId,
        faceId: `face_${id}` as FaceId,
      },
      topology: "face",
      semanticClass,
    },
    geometry: {
      kind: "mesh",
      vertexPositions: vertices,
      vertexNormals: null,
      triangleIndices: triangles,
    },
  };
}
