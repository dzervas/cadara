import { test, expect } from "vitest";

import {
  assembleFixtureCaptureBundle,
  FIXTURE_PART_STUDIO_ID,
} from "@/cli/commands/onshape-capture/fixtures/capture-bundle-fixture";
import {
  listPartStudios,
  readPartStudio,
} from "@/domain/import/onshape/bundle-reader";

test("src/domain/import/onshape/bundle-reader.spec.ts", async () => {
  const bundle = await assembleFixtureCaptureBundle();

  const studios = listPartStudios(bundle);
  expect(
    studios.length,
    "Both fixture Part Studios should be listed for import selection.",
  ).toBe(2);

  const mounts = readPartStudio(bundle, FIXTURE_PART_STUDIO_ID);
  expect(
    mounts.diagnostics.length,
    "The Mounts studio payloads should read cleanly with no diagnostics.",
  ).toBe(0);
  expect(
    mounts.features.map((feature) => feature.featureType),
    "Feature nodes should be narrowly read with their feature types intact.",
  ).toEqual(["newSketch", "extrude", "newSketch"]);
  const solved = mounts.solvedSketchesByFeatureId.get("FOoap8tw3jKAJf5_0");
  expect(
    solved?.entities[0]?.entityType === "circle" &&
      solved.entities[0]?.radius === 0.005,
    "Real solved-sketch entities (BTSketchCurveSegmentInfo) should be parsed with geometry.",
  ).toBeTruthy();

  const missing = readPartStudio(bundle, "not-a-real-element");
  expect(
    missing.diagnostics[0]?.code,
    "Reading an absent studio should yield an explicit not-found diagnostic.",
  ).toBe("onshape-studio-not-found");
});


test("normalizes raw sketch relationship records", async () => {
  const bundle = await assembleFixtureCaptureBundle();
  const studio = bundle.partStudios[0]!;
  const features = studio.features as { features: Array<Record<string, unknown>> };
  features.features[0]!.constraints = [
    {
      constraintType: "COINCIDENT",
      entityId: "line1.startSnap",
      parameters: [
        { parameterId: "localFirst", value: "line1.start" },
        { parameterId: "localSecond", value: "line2.end" },
      ],
    },
  ];

  const read = readPartStudio(bundle, studio.elementId);
  expect(read.features[0]?.constraints).toEqual([
    {
      constraintType: "COINCIDENT",
      entityId: "line1.startSnap",
      parameters: [
        { parameterId: "localFirst", value: "line1.start", hasExternalQuery: false },
        { parameterId: "localSecond", value: "line2.end", hasExternalQuery: false },
      ],
    },
  ]);
});
