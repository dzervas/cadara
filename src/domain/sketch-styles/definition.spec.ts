import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import {
  SKETCH_STYLE_PATCH_INTENT,
  buildSketchStyleControls,
  buildSketchStylePresentation,
  parseSketchStylePatch,
} from "@/domain/sketch-styles/definition";

test("src/domain/sketch-styles/definition.spec.ts", () => {
  const controls = buildSketchStyleControls(undefined);
  expectTrue(
    controls.some((control) => control.id === "sketch-style-fill-mode"),
    "Style controls should expose fill mode.",
  );
  expectTrue(
    controls.some((control) => control.id === "sketch-style-gradient-start"),
    "Style controls should expose gradient start color.",
  );
  expectTrue(
    controls.some((control) => control.id === "sketch-style-stroke-join"),
    "Style controls should expose stroke join.",
  );
  expectTrue(
    controls.some(
      (control) => control.id === "sketch-style-stroke-miter-limit",
    ),
    "Style controls should expose stroke miter limit.",
  );
  expectTrue(
    controls.some((control) => control.id === "sketch-style-stroke-dash-size"),
    "Style controls should expose stroke dash size.",
  );
  expectTrue(
    controls.some((control) => control.id === "sketch-style-stroke-gap-size"),
    "Style controls should expose stroke gap size.",
  );
  const defaultStrokeEnabled = controls.find(
    (control) => control.id === "sketch-style-stroke-enabled",
  );
  const defaultStrokeColor = controls.find(
    (control) => control.id === "sketch-style-stroke-color",
  );
  expectTrue(
    defaultStrokeEnabled?.kind === "toggle" &&
      defaultStrokeEnabled.value === false,
    "Stroke styling should be disabled by default.",
  );
  expectTrue(
    defaultStrokeColor?.disabled === true,
    "Stroke controls should be disabled until stroke styling is enabled.",
  );

  const accepted = parseSketchStylePatch({
    intent: SKETCH_STYLE_PATCH_INTENT,
    field: "strokeWidth",
    value: 3,
  });
  expectTrue(
    accepted?.field === "strokeWidth" && accepted.value === 3,
    "Style patch parser should accept local style fields.",
  );

  const acceptedDash = parseSketchStylePatch({
    intent: SKETCH_STYLE_PATCH_INTENT,
    field: "strokeDashSize",
    value: 0.75,
  });
  expectTrue(
    acceptedDash?.field === "strokeDashSize" && acceptedDash.value === 0.75,
    "Style patch parser should accept dash fields.",
  );

  const acceptedMiter = parseSketchStylePatch({
    intent: SKETCH_STYLE_PATCH_INTENT,
    field: "strokeMiterLimit",
    value: 8,
  });
  expectTrue(
    acceptedMiter?.field === "strokeMiterLimit" && acceptedMiter.value === 8,
    "Style patch parser should accept miter fields.",
  );

  const strokePresentation = buildSketchStylePresentation(
    {
      toolId: "stroke",
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_draft",
        entityId: "sketch_entity_1",
      },
    },
    undefined,
  );
  expectTrue(
    strokePresentation.controlGroups?.[0]?.controls.some(
      (control) => control.id === "sketch-style-stroke-enabled",
    ) &&
      strokePresentation.controlGroups[0]?.controls.some(
        (control) => control.id === "sketch-style-stroke-dash-size",
      ) &&
      strokePresentation.controlGroups[0]?.controls.some(
        (control) => control.id === "sketch-style-stroke-gap-size",
      ),
    "Focused stroke presentation should expose stroke enablement and dash controls.",
  );

  const guidancePresentation = buildSketchStylePresentation(
    { toolId: "fill", target: null },
    undefined,
  );
  expectTrue(
    guidancePresentation.selectionGuide?.requiredCount === 1 &&
      guidancePresentation.selectionGuide.acceptedKinds.includes("region") &&
      guidancePresentation.controls?.length === 0,
    "Fill presentation should request an enclosed region target when no compatible target is selected.",
  );

  const rejected = parseSketchStylePatch({
    intent: SKETCH_STYLE_PATCH_INTENT,
    field: "externalGeometryRef",
    value: "paint://other-sketch",
  });
  expectTrue(
    rejected === null,
    "Style patch parser should ignore external style sources.",
  );
});
