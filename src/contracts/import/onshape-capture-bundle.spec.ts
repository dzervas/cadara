import { test, expect } from "vitest";

import {
  ONSHAPE_CAPTURE_BUNDLE_FORMAT_VERSION,
  requireOnshapeCaptureBundle,
  validateOnshapeCaptureBundle,
  type OnshapeCaptureBundle,
} from "@/contracts/import/onshape-capture-bundle";

function makeValidBundle(): OnshapeCaptureBundle {
  return {
    formatVersion: 1,
    provenance: {
      capturedAt: "2026-01-01T00:00:00.000Z",
      cliVersion: "0.0.1",
      apiVersion: "v10",
      baseUrl: "https://cad.onshape.com/api/v10",
      documentId: "40a51fb8fa82fd4565151114",
      wvm: "w",
      wvmId: "a14bbd18c43e1cd99d2cfc48",
      microversion: "c34b869c9f096a9a8bf455e6",
    },
    document: { jsonType: "document" },
    elements: [{ id: "865452a3e2270f0ebca3ce63", elementType: "PARTSTUDIO" }],
    partStudios: [
      {
        elementId: "865452a3e2270f0ebca3ce63",
        name: "Mounts",
        features: { features: [] },
        sketches: { sketches: [] },
        parts: [],
        featureSpecs: { present: true, response: { featureSpecs: [] } },
        resolvedReferences: [
          {
            deterministicId: "BTMIndividualQuery-138",
            evaluatedAt: "finalState",
            signature: {
              entityClass: "face",
              geometryType: "plane",
              definingData: { origin: [0, 0, 0], normal: [0, 0, 1] },
              isDefaultPlane: true,
            },
          },
          {
            deterministicId: "BTMIndividualQuery-999",
            evaluatedAt: "finalState",
            unresolved: { reason: "entity absent in final state" },
          },
        ],
        groundTruth: {
          hasBodies: true,
          tessellationTolerance: 0.0001,
          tessellatedFaces: { faces: [] },
          step: "ISO-10303-21;",
        },
        rollbackSnapshots: null,
      },
    ],
  };
}

test("src/contracts/import/onshape-capture-bundle.spec.ts accepts a well-formed bundle", () => {
  const result = validateOnshapeCaptureBundle(makeValidBundle());
  expect(
    result.success,
    "Envelope schema should accept a complete, well-formed capture bundle.",
  ).toBeTruthy();

  expect(
    ONSHAPE_CAPTURE_BUNDLE_FORMAT_VERSION,
    "Format version constant should match the accepted envelope version.",
  ).toBe(1);
});

test("src/contracts/import/onshape-capture-bundle.spec.ts accepts an empty Part Studio ground truth", () => {
  const bundle = makeValidBundle();
  bundle.partStudios[0]!.groundTruth = { hasBodies: false };
  bundle.partStudios[0]!.featureSpecs = {
    present: false,
    reason: "featurespecs endpoint returned 404",
  };

  expect(
    validateOnshapeCaptureBundle(bundle).success,
    "Envelope schema should accept absent optional sections and empty studios.",
  ).toBeTruthy();
});

test("src/contracts/import/onshape-capture-bundle.spec.ts rejects wrong format version", () => {
  const bundle = { ...makeValidBundle(), formatVersion: 2 };
  expect(
    validateOnshapeCaptureBundle(bundle).success,
    "Envelope schema should reject an unsupported format version.",
  ).toBeFalsy();
});

test("src/contracts/import/onshape-capture-bundle.spec.ts rejects missing provenance fields", () => {
  const bundle = makeValidBundle() as unknown as {
    provenance: Record<string, unknown>;
  };
  delete bundle.provenance.microversion;
  expect(
    validateOnshapeCaptureBundle(bundle).success,
    "Envelope schema should reject provenance missing the microversion pin.",
  ).toBeFalsy();
});

test("src/contracts/import/onshape-capture-bundle.spec.ts rejects a resolved reference with both signature and unresolved", () => {
  const bundle = makeValidBundle();
  (bundle.partStudios[0]!.resolvedReferences[1] as Record<string, unknown>) = {
    deterministicId: "BTMIndividualQuery-999",
    evaluatedAt: "finalState",
    signature: { entityClass: "face", geometryType: "plane" },
    unresolved: { reason: "should not coexist with a signature" },
  };
  expect(
    validateOnshapeCaptureBundle(bundle).success,
    "Envelope schema should reject a reference carrying both a signature and an unresolved reason.",
  ).toBeFalsy();
});

test("src/contracts/import/onshape-capture-bundle.spec.ts requireOnshapeCaptureBundle throws with issues", () => {
  expect(() => requireOnshapeCaptureBundle({ formatVersion: 1 })).toThrow();
});
