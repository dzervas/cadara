import { test, expect } from "vitest";

import {
  requireReferenceImageOperationState,
  requireReferenceImagePayload,
  validateReferenceImageCalibrationAnchor,
  validateReferenceImageCalibrationState,
  validateReferenceImageOperationState,
  validateReferenceImagePayload,
  validateReferenceImagePlacement,
} from "@/contracts/reference-image/runtime-schema";

test("src/contracts/reference-image/runtime-schema.spec.ts", () => {
  const validPayload = {
    mediaType: "image/png",
    fileName: "reference.png",
    pixelWidth: 640,
    pixelHeight: 480,
    base64Data: "aW1hZ2U=",
  };
  const validPlacement = {
    center: [0, 0],
    width: 10,
    height: 7.5,
    rotationRadians: 0,
  };
  const validCalibration = {
    scaleMode: "lockedAspect",
    showExportedAnchorsInSketch: true,
    anchors: [
      {
        anchorId: "anchor_1",
        label: "A",
        uv: [0.25, 0.75],
        pointId: "sketch_point_1",
      },
    ],
  };
  const validState = {
    kind: "referenceImage",
    image: validPayload,
    placement: validPlacement,
    calibration: validCalibration,
  };

  expect(
    validateReferenceImagePayload(validPayload).success,
    "Reference-image payload validation should accept canonical image payloads.",
  ).toBeTruthy();
  expect(
    validateReferenceImagePlacement(validPlacement).success,
    "Reference-image placement validation should accept positive finite placement payloads.",
  ).toBeTruthy();
  expect(
    validateReferenceImageCalibrationState(validCalibration).success,
    "Reference-image calibration validation should accept in-bounds anchors.",
  ).toBeTruthy();
  expect(
    validateReferenceImageOperationState(validState).success,
    "Reference-image operation-state validation should compose image, placement, and calibration invariants.",
  ).toBeTruthy();

  const invalidPayload = {
    mediaType: "",
    pixelWidth: 0,
    pixelHeight: 0,
    base64Data: "",
  };
  expect(
    validateReferenceImagePayload(invalidPayload).success,
    "Reference-image payload validation should reject empty media, empty data, and non-positive dimensions.",
  ).toBeFalsy();
  try {
    requireReferenceImagePayload(invalidPayload);
    expect(
      false,
      "Required reference-image payload validation should reject invalid payloads.",
    ).toBeTruthy();
  } catch (error) {
    expect(
      error instanceof Error,
      "Required reference-image payload validation should throw for invalid payloads.",
    ).toBeTruthy();
  }

  expect(
    validateReferenceImagePlacement({
      ...validPlacement,
      width: 0,
    }).success,
    "Reference-image placement validation should reject non-positive bounds.",
  ).toBeFalsy();
  expect(
    validateReferenceImageCalibrationAnchor({
      anchorId: "anchor_2",
      label: "B",
      uv: [1.1, 0.5],
      pointId: "sketch_point_2",
    }).success,
    "Reference-image calibration anchor validation should reject UVs outside image bounds.",
  ).toBeFalsy();
  expect(
    validateReferenceImageCalibrationState({
      ...validCalibration,
      anchors: [
        ...validCalibration.anchors,
        {
          anchorId: "anchor_1",
          label: "Duplicate",
          uv: [0.5, 0.5],
          pointId: "sketch_point_2",
        },
      ],
    }).success,
    "Reference-image calibration validation should reject duplicate anchor ids.",
  ).toBeFalsy();

  const invalidState = {
    kind: "referenceImage",
    image: invalidPayload,
    placement: {
      ...validPlacement,
      height: 0,
    },
    calibration: {
      ...validCalibration,
      anchors: [
        {
          anchorId: "anchor_3",
          label: "C",
          uv: [-0.1, 0.5],
          pointId: "sketch_point_3",
        },
      ],
    },
  };
  expect(
    validateReferenceImageOperationState(invalidState).success,
    "Reference-image operation-state validation should reject invalid nested payloads.",
  ).toBeFalsy();
  try {
    requireReferenceImageOperationState(invalidState);
    expect(
      false,
      "Required reference-image operation-state validation should reject invalid nested payloads.",
    ).toBeTruthy();
  } catch (error) {
    expect(
      error instanceof Error,
      "Required reference-image operation-state validation should throw for invalid nested payloads.",
    ).toBeTruthy();
  }
});
