import { test, expect } from "vitest";

import type { HistoryProbeTopologySignature } from "@/contracts/import/capabilities";
import type { OnshapeGeometricSignature } from "@/contracts/import/onshape-capture-bundle";
import { matchSignature } from "@/domain/import/onshape/signature-matcher";

function probeFace(
  id: string,
  centroid: [number, number, number],
): HistoryProbeTopologySignature {
  return {
    entityClass: "face",
    geometryType: "plane",
    centroid,
    reference: { kind: "face", bodyId: `body_${id}` as never, faceId: `face_${id}` as never },
  };
}

test("src/domain/import/onshape/signature-matcher.spec.ts", () => {
  const captured: OnshapeGeometricSignature = {
    entityClass: "face",
    geometryType: "PLANE",
    centroid: [1, 1, 1],
  };

  const unique = matchSignature(captured, [
    probeFace("a", [1, 1, 1]),
    probeFace("b", [5, 5, 5]),
  ]);
  expect(
    unique.kind,
    "A single in-tolerance candidate should resolve uniquely.",
  ).toBe("unique");

  const ambiguous = matchSignature(captured, [
    probeFace("a", [1, 1, 1]),
    probeFace("b", [1, 1, 1]),
  ]);
  expect(
    ambiguous.kind,
    "Symmetric geometry with two equidistant candidates should be ambiguous, never guessed.",
  ).toBe("ambiguous");

  const noMatch = matchSignature(captured, [probeFace("far", [9, 9, 9])]);
  expect(
    noMatch.kind,
    "No in-tolerance candidate should be a miss.",
  ).toBe("noMatch");

  const wrongClass = matchSignature(captured, [
    {
      entityClass: "edge",
      geometryType: "plane",
      centroid: [1, 1, 1],
      reference: { kind: "edge", bodyId: "body_x" as never, edgeId: "edge_x" as never },
    },
  ]);
  expect(
    wrongClass.kind,
    "Entity-class mismatch must never match.",
  ).toBe("noMatch");
});
