import { expect, test } from "vitest";

import boxFixture from "@/domain/modeling/occ/fixtures/topology-signatures/box.payload.json";
import cylinderBossFixture from "@/domain/modeling/occ/fixtures/topology-signatures/cylinder-boss.payload.json";
import filletedBlockFixture from "@/domain/modeling/occ/fixtures/topology-signatures/filleted-block.payload.json";
import type { BodyId, RevisionId } from "@/contracts/shared/ids";
import {
  createOccNativeExactBrepPayloadFromShimPayload,
  parseNativeShimPayloadJson,
  type OccNativeExactBrepPayload,
} from "@/domain/modeling/occ/native-topology-payload";
import { deriveKernelTopologySignaturesFromExactBrepPayload } from "@/domain/modeling/occ/topology-signatures";

function exactBrepPayloadFromFixture(
  fixture: { exactBrep: unknown },
  bodyId: BodyId,
): OccNativeExactBrepPayload {
  return createOccNativeExactBrepPayloadFromShimPayload({
    revisionId: `rev_${bodyId}` as RevisionId,
    target: { kind: "body", bodyId },
    bodyId,
    bodyLabel: bodyId,
    nativePayload: parseNativeShimPayloadJson(JSON.stringify(fixture.exactBrep)),
  });
}

test("derives supported topology signatures from native exact-B-rep payload fixtures", () => {
  const boxResult = deriveKernelTopologySignaturesFromExactBrepPayload(
    exactBrepPayloadFromFixture(boxFixture, "body_signature_fixture_box" as BodyId),
  );
  const cylinderBossResult = deriveKernelTopologySignaturesFromExactBrepPayload(
    exactBrepPayloadFromFixture(
      cylinderBossFixture,
      "body_signature_fixture_cylinder_boss" as BodyId,
    ),
  );
  const filletedBlockResult = deriveKernelTopologySignaturesFromExactBrepPayload(
    exactBrepPayloadFromFixture(
      filletedBlockFixture,
      "body_signature_fixture_filleted_block" as BodyId,
    ),
  );

  expect(boxResult.status).toBe("available");
  expect(cylinderBossResult.status).toBe("available");
  expect(filletedBlockResult.status).toBe("available");
  if (
    boxResult.status !== "available" ||
    cylinderBossResult.status !== "available" ||
    filletedBlockResult.status !== "available"
  ) {
    return;
  }

  expect(
    boxResult.signatures.some(
      (signature) =>
        signature.entityClass === "face" &&
        signature.geometryType === "plane" &&
        signature.reference.kind === "face" &&
        signature.boundingBox != null &&
        signature.centroid != null &&
        signature.definingData != null,
    ),
    "Box fixture should derive durable planar face signatures with bbox, centroid, and defining data.",
  ).toBeTruthy();
  expect(
    boxResult.signatures.some(
      (signature) =>
        signature.entityClass === "edge" &&
        signature.geometryType === "line" &&
        signature.reference.kind === "edge" &&
        signature.definingData != null,
    ),
    "Box fixture should derive durable line edge signatures.",
  ).toBeTruthy();
  expect(
    cylinderBossResult.signatures.some(
      (signature) =>
        signature.entityClass === "face" &&
        signature.geometryType === "cylinder" &&
        signature.definingData?.radius === 0.75,
    ),
    "Cylinder boss fixture should derive cylinder face signatures with radius defining data.",
  ).toBeTruthy();
  expect(
    cylinderBossResult.signatures.some(
      (signature) =>
        signature.entityClass === "edge" &&
        signature.geometryType === "circle" &&
        signature.definingData?.radius === 0.75,
    ),
    "Cylinder boss fixture should derive circular edge signatures with radius defining data.",
  ).toBeTruthy();
  expect(
    filletedBlockResult.signatures.some(
      (signature) =>
        signature.entityClass === "face" &&
        signature.geometryType === "cylinder",
    ),
    "Filleted block fixture should expose cylindrical fillet face signatures.",
  ).toBeTruthy();
});

test("derives generic signatures for unsupported exact-B-rep geometry without fabricating defining data", () => {
  const payload = structuredClone(
    exactBrepPayloadFromFixture(boxFixture, "body_signature_fixture_box" as BodyId),
  ) as OccNativeExactBrepPayload;
  const face = payload.brep.bodies[0]?.topology.faces[0];
  const edge = payload.brep.bodies[0]?.topology.edges[0];

  if (!face || !edge) {
    throw new Error("Fixture must include a face and edge for unsupported fallback coverage.");
  }

  face.surface = { kind: "unsupported", typeName: "Geom_BSplineSurface" };
  edge.curve = { kind: "unsupported", typeName: "Geom_BSplineCurve" };

  const result = deriveKernelTopologySignaturesFromExactBrepPayload(payload);

  expect(result.status).toBe("available");
  if (result.status !== "available") {
    return;
  }

  const genericFace = result.signatures.find(
    (signature) => signature.reference.kind === "face" && signature.reference.faceId === face.faceKey,
  );
  const genericEdge = result.signatures.find(
    (signature) => signature.reference.kind === "edge" && signature.reference.edgeId === edge.edgeKey,
  );

  expect(genericFace?.geometryType).toBe("generic-surface");
  expect(genericFace?.definingData).toBeUndefined();
  expect(genericFace?.boundingBox).toBeDefined();
  expect(genericFace?.centroid).toBeDefined();
  expect(genericEdge?.geometryType).toBe("generic-curve");
  expect(genericEdge?.definingData).toBeUndefined();
});

test("returns a structured capability diagnostic when exact-B-rep records are absent", () => {
  const payload = structuredClone(
    exactBrepPayloadFromFixture(boxFixture, "body_signature_fixture_box" as BodyId),
  ) as OccNativeExactBrepPayload;
  payload.tables.curves = { rowCount: 0, columns: {} };
  payload.tables.surfaces = { rowCount: 0, columns: {} };

  const result = deriveKernelTopologySignaturesFromExactBrepPayload(payload);

  expect(result.status).toBe("unavailable");
  expect(result.signatures).toEqual([]);
  expect(result.diagnostics[0]).toMatchObject({
    code: "kernel-topology-signatures-missing-exact-brep-records",
    severity: "error",
    target: payload.target,
  });
});
