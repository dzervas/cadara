import { expect, test } from "vitest";

import { fallbackFeatureTranslator } from "@/domain/import/onshape/fallback-feature-translator";
import type { OnshapeFeatureNode } from "@/domain/import/onshape/bundle-reader";

function reason(featureType: string) {
  return fallbackFeatureTranslator.plan({
    feature: { featureId: `F_${featureType}`, featureType, name: featureType } as OnshapeFeatureNode,
    label: featureType,
    onshapeSuppressed: false,
    read: {} as never,
    references: new Map(),
    state: { bakedLineageFeatureIds: new Set(), sketchPlansByFeatureId: new Map(), bodyProducingFeatureIds: [] },
  }).reasonCodes;
}

test("classifies Wave C out-of-scope families explicitly and preserves the unknown fallback", () => {
  expect(reason("sheetMetalFlange")).toEqual(["sheet-metal-unsupported"]);
  expect(reason("ruledSurface")).toEqual(["surface-modeling-unsupported"]);
  expect(reason("offsetCurveOnFace")).toEqual(["curve-modeling-unsupported"]);
  expect(reason("sphere")).toEqual(["primitive-unsupported"]);
  expect(reason("tag")).toEqual(["annotation-meta-unsupported"]);
  expect(reason("frameTrim")).toEqual(["part-operation-unsupported"]);
  expect(reason("circularPattern")).toEqual(["pattern-unsupported"]);
  expect(reason("diameterTolerance")).toEqual(["tolerance-unsupported"]);
  expect(reason("unrecognizedPluginFeature")).toEqual(["custom-feature"]);
});
