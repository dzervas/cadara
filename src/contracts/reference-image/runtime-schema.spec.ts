import { test } from "vitest";

import { expectTrue } from "@/testing/expect.spec";
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

  expectTrue(
    validateReferenceImagePayload(validPayload).success,
    "Reference-image payload validation should accept canonical image payloads.",
  );
  expectTrue(
    validateReferenceImagePlacement(validPlacement).success,
    "Reference-image placement validation should accept positive finite placement payloads.",
  );
  expectTrue(
    validateReferenceImageCalibrationState(validCalibration).success,
    "Reference-image calibration validation should accept in-bounds anchors.",
  );
  expectTrue(
    validateReferenceImageOperationState(validState).success,
    "Reference-image operation-state validation should compose image, placement, and calibration invariants.",
  );

  const invalidPayload = {
    mediaType: "",
    pixelWidth: 0,
    pixelHeight: 0,
    base64Data: "",
  };
  expectTrue(
    !validateReferenceImagePayload(invalidPayload).success,
    "Reference-image payload validation should reject empty media, empty data, and non-positive dimensions.",
  );
  try {
    requireReferenceImagePayload(invalidPayload);
    expectTrue(
      false,
      "Required reference-image payload validation should reject invalid payloads.",
    );
  } catch (error) {
    expectTrue(
      error instanceof Error,
      "Required reference-image payload validation should throw for invalid payloads.",
    );
  }

  expectTrue(
    !validateReferenceImagePlacement({
      ...validPlacement,
      width: 0,
    }).success,
    "Reference-image placement validation should reject non-positive bounds.",
  );
  expectTrue(
    !validateReferenceImageCalibrationAnchor({
      anchorId: "anchor_2",
      label: "B",
      uv: [1.1, 0.5],
      pointId: "sketch_point_2",
    }).success,
    "Reference-image calibration anchor validation should reject UVs outside image bounds.",
  );
  expectTrue(
    !validateReferenceImageCalibrationState({
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
  );

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
  expectTrue(
    !validateReferenceImageOperationState(invalidState).success,
    "Reference-image operation-state validation should reject invalid nested payloads.",
  );
  try {
    requireReferenceImageOperationState(invalidState);
    expectTrue(
      false,
      "Required reference-image operation-state validation should reject invalid nested payloads.",
    );
  } catch (error) {
    expectTrue(
      error instanceof Error,
      "Required reference-image operation-state validation should throw for invalid nested payloads.",
    );
  }
});
