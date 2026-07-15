import { expect, test } from "vitest";

import type { StudioReadResult } from "@/domain/import/onshape/bundle-reader";
import {
  loftFeatureTranslator,
  revolveFeatureTranslator,
  sweepFeatureTranslator,
  thickenFeatureTranslator,
} from "@/domain/import/onshape/wave-a-feature-translators";

function makeRead(featureType: "revolve" | "thicken" | "sweep" | "loft"): StudioReadResult {
  const feature = {
    featureType,
    featureId: `F_${featureType.toUpperCase()}`,
    name: featureType,
    parameters:
      featureType === "revolve"
        ? [
            {
              btType: "BTMParameterQueryList-148",
              parameterId: "entities",
              queries: [
                {
                  queryString: 'query = qSketchRegion(id + "S_PROFILE", true);',
                },
              ],
            },
            {
              btType: "BTMParameterQueryList-148",
              parameterId: "axis",
              queries: [
                {
                  queryString:
                    'query=qCompressed(1.0,"$operationId$S_PROFILEwireOp$queryType$SKETCH_ENTITY$sketchEntityId$axis_line",id);',
                },
              ],
            },
            { btType: "BTMParameterEnum-145", parameterId: "bodyType", value: "SOLID" },
            { btType: "BTMParameterEnum-145", parameterId: "operationType", value: "NEW" },
            { btType: "BTMParameterEnum-145", parameterId: "revolveType", value: "ONE_DIRECTION" },
            {
              btType: "BTMParameterQuantity-147",
              parameterId: "angle",
              expression: "#turns * 30 deg",
              value: Math.PI / 6,
            },
            { btType: "BTMParameterBoolean-144", parameterId: "oppositeDirection", value: false },
          ]
        : [],
  };
  return {
    studio: {
      elementId: "e1",
      name: "Wave A synthetic",
      features: null,
      sketches: null,
      parts: null,
      featureSpecs: { present: false, reason: "synthetic" },
      resolvedReferences: [],
      groundTruth: { hasBodies: false },
      rollbackSnapshots: null,
    },
    features: [feature],
    solvedSketchesByFeatureId: new Map([
      [
        "S_PROFILE",
        {
          featureId: "S_PROFILE",
          entities: [
            {
              entityId: "profile_circle",
              entityType: "circle",
              onshapeEntityType: "skCircle",
              isConstruction: false,
              center3d: [0.01, 0, 0],
              radius: 0.004,
            },
            {
              entityId: "axis_line",
              entityType: "lineSegment",
              onshapeEntityType: "skLineSegment",
              isConstruction: true,
              start3d: [0, -0.01, 0],
              end3d: [0, 0.01, 0],
            },
          ],
        },
      ],
    ]),
    diagnostics: [],
  };
}

function plan(featureType: "revolve" | "thicken" | "sweep" | "loft") {
  const read = makeRead(featureType);
  const feature = read.features[0]!;
  const translator = {
    revolve: revolveFeatureTranslator,
    thicken: thickenFeatureTranslator,
    sweep: sweepFeatureTranslator,
    loft: loftFeatureTranslator,
  }[featureType];
  return translator.plan({
    feature,
    label: feature.name ?? feature.featureId,
    onshapeSuppressed: false,
    read,
    references: new Map(),
    state: {
      bakedLineageFeatureIds: new Set(),
      sketchPlansByFeatureId: new Map([
        ["S_PROFILE", { tier: "parametric", planeKey: "xy" }],
      ]),
      bodyProducingFeatureIds: [],
    },
  });
}

test("Wave A revolve plans a verified region, local sketch-line axis, and expression-backed angle", () => {
  const result = plan("revolve");
  expect(result.tier).toBe("parametric");
  expect(result.plannedRevolve?.profiles).toHaveLength(1);
  expect(result.plannedRevolve?.axisEntityId).toBeDefined();
  expect(result.plannedRevolve?.extent).toMatchObject({
    mode: "oneSide",
    end: {
      kind: "blind",
      angle: { source: "expression" },
    },
  });
  const end = result.plannedRevolve?.extent.mode === "oneSide"
    ? result.plannedRevolve.extent.end
    : null;
  expect(end?.kind === "blind" ? end.angle : null).toMatchObject({
    valueText: expect.stringContaining("turns"),
  });
});

test("Wave A thicken degrades specifically because face topology is required", () => {
  expect(plan("thicken")).toMatchObject({
    tier: "baked",
    reasonCodes: ["thicken-requires-topology"],
  });
});

test("Wave A sweep degrades specifically when an Onshape path cannot be losslessly resolved", () => {
  expect(plan("sweep")).toMatchObject({
    tier: "baked",
    reasonCodes: ["sweep-path-unresolved"],
  });
});

test("Wave A loft degrades specifically when ordered Onshape profile arrays cannot be resolved", () => {
  expect(plan("loft")).toMatchObject({
    tier: "baked",
    reasonCodes: ["loft-profile-unresolved"],
  });
});
