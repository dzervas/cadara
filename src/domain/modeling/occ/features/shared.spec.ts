import { expect, test } from "vitest";

import type { BodyId, EdgeId, FaceId, FeatureId, VertexId } from "@/contracts/shared/ids";
import {
  requireEdge,
  requireFace,
  requireVertex,
  type OccFeatureExecutionContext,
} from "@/domain/modeling/occ/features/shared";
import { assertValidFeatureResultShape } from "@/domain/modeling/occ/features/boolean-operations";
import { getDefaultOpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { trackNewSolidBody } from "@/domain/modeling/occ/topology";

test("native aliases win when a preserved public id collides with a current OCC id", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const box = new oc.BRepPrimAPI_MakeBox_2(2, 3, 4);
  box.Build(new oc.Message_ProgressRange_1());
  const tracked = trackNewSolidBody(oc, {
    bodyId: "body_native_alias_collision" as BodyId,
    label: "alias collision",
    ownerFeatureId: "feature_native_alias_collision" as FeatureId,
    shape: box.Shape(),
  });
  const [nativeFaceId, collidingFaceId] = tracked.topology.faceIds as [FaceId, FaceId];
  const [nativeEdgeId, collidingEdgeId] = tracked.topology.edgeIds as [EdgeId, EdgeId];
  const [nativeVertexId, collidingVertexId] = tracked.topology.vertexIds as [
    VertexId,
    VertexId,
  ];
  const body = {
    ...tracked,
    nativeTopologyIdAliases: {
      faceIdsByNativeId: new Map([[nativeFaceId, collidingFaceId]]),
      edgeIdsByNativeId: new Map([[nativeEdgeId, collidingEdgeId]]),
      vertexIdsByNativeId: new Map([[nativeVertexId, collidingVertexId]]),
    },
  };
  const context = {} as OccFeatureExecutionContext;

  expect(
    requireFace(context, body, collidingFaceId).IsSame(
      tracked.facesById.get(nativeFaceId)!,
    ),
  ).toBe(true);
  expect(
    requireEdge(context, body, collidingEdgeId).IsSame(
      tracked.edgesById.get(nativeEdgeId)!,
    ),
  ).toBe(true);
  expect(
    requireVertex(context, body, collidingVertexId).IsSame(
      tracked.verticesById.get(nativeVertexId)!,
    ),
  ).toBe(true);
});


test("feature results reject a real OCC solid with an open shell", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const box = new oc.BRepPrimAPI_MakeBox_2(2, 3, 4);
  box.Build(new oc.Message_ProgressRange_1());
  const tracked = trackNewSolidBody(oc, {
    bodyId: "body_invalid_result" as BodyId,
    label: "invalid result",
    ownerFeatureId: "feature_invalid_result" as FeatureId,
    shape: box.Shape(),
  });
  const builder = new oc.BRep_Builder();
  const shell = new oc.TopoDS_Shell();
  builder.MakeShell(shell);
  for (const face of [...tracked.facesById.values()].slice(1)) {
    builder.Add(shell, face);
  }
  const solid = new oc.TopoDS_Solid();
  builder.MakeSolid(solid);
  builder.Add(solid, shell);

  expect(() =>
    assertValidFeatureResultShape(
      { oc } as OccFeatureExecutionContext,
      solid,
      "preview",
    ),
  ).toThrow(/occ-invalid-result-topology.*non-manifold/i);
});
