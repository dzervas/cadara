import { expect, test } from "vitest";

import {
  validateFeatureDefinition,
  validateModelingDiagnostic,
} from "@/contracts/modeling/runtime-schema";
import { BAKED_BODY_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";

test("bakedBody feature definitions validate asset references and provenance", () => {
  const result = validateFeatureDefinition({
    kind: "bakedBody",
    featureTypeVersion: BAKED_BODY_FEATURE_SCHEMA_VERSION,
    parameters: {
      assetId: "asset_taskariki_final_mesh",
      format: "baked-mesh",
      hash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      byteLength: 2048,
      label: "Taskariki baked body (features 7-41)",
      provenance: {
        source: "onshape",
        sourceId: "studio_taskariki",
        sourceName: "Taskariki",
        featureSpan: {
          fromFeatureId: "JZcABf",
          toFeatureId: "Mpa1dT",
        },
        reason: "onshape-studio-bake-required",
      },
    },
  });

  expect(
    result.success,
    "Runtime schema should accept a baked body with an asset id, format, label, and provenance.",
  ).toBeTruthy();
});

test("bakedBody feature definitions reject malformed asset ids", () => {
  const result = validateFeatureDefinition({
    kind: "bakedBody",
    featureTypeVersion: BAKED_BODY_FEATURE_SCHEMA_VERSION,
    parameters: {
      assetId: "not-an-asset-id",
      format: "baked-mesh",
      label: "Bad baked body",
      provenance: { source: "onshape" },
    },
  });

  expect(
    result.success,
    "Runtime schema should enforce the durable asset id prefix for baked bodies.",
  ).toBeFalsy();
});

test("bakedBody feature definitions reject missing provenance", () => {
  const result = validateFeatureDefinition({
    kind: "bakedBody",
    featureTypeVersion: BAKED_BODY_FEATURE_SCHEMA_VERSION,
    parameters: {
      assetId: "asset_without_provenance",
      format: "baked-mesh",
      label: "No provenance",
    },
  });

  expect(
    result.success,
    "Runtime schema should require honest baked-body provenance rather than pseudo-parametric controls.",
  ).toBeFalsy();
});

test("bakedBody diagnostics validate structured materialization failures", () => {
  const result = validateModelingDiagnostic({
    code: "baked-body-materialization-failed",
    severity: "error",
    message: "Could not materialize baked mesh asset.",
    featureId: "feature_baked_taskariki",
    target: null,
    detail: {
      kind: "bakedBody",
      reason: "materializationFailed",
      assetId: "asset_taskariki_final_mesh",
      format: "baked-mesh",
      message: "Worker rejected the mesh topology.",
    },
  });

  expect(
    result.success,
    "Runtime schema should accept structured baked-body diagnostics for materialization failures.",
  ).toBeTruthy();
});
