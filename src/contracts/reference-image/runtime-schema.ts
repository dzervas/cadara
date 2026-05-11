import typia from "typia";

import type {
  ReferenceImageCalibrationAnchor,
  ReferenceImageCalibrationState,
  ReferenceImageOperationState,
  ReferenceImagePayload,
  ReferenceImagePlacement,
} from "@/contracts/reference-image/schema";
import {
  ContractValidationError,
  validateContract,
  type ContractValidationIssue,
  type ContractValidationResult,
} from "@/contracts/shared/validation";

const referenceImagePayloadValidator =
  typia.createValidateEquals<ReferenceImagePayload>();
const referenceImagePlacementValidator =
  typia.createValidateEquals<ReferenceImagePlacement>();
const referenceImageCalibrationAnchorValidator =
  typia.createValidateEquals<ReferenceImageCalibrationAnchor>();
const referenceImageCalibrationStateValidator =
  typia.createValidateEquals<ReferenceImageCalibrationState>();
const referenceImageOperationStateValidator =
  typia.createValidateEquals<ReferenceImageOperationState>();

export function validateReferenceImagePayload(
  value: unknown,
): ContractValidationResult<ReferenceImagePayload> {
  const result = validateContract(referenceImagePayloadValidator, value);
  if (!result.success) {
    return result;
  }

  const invariantIssues = validateReferenceImagePayloadInvariants(result.data);
  return invariantIssues.length === 0
    ? result
    : {
        success: false,
        data: result.data,
        issues: invariantIssues,
      };
}

export function requireReferenceImagePayload(
  value: unknown,
): ReferenceImagePayload {
  return requireValidationResult(
    validateReferenceImagePayload(value),
    value,
    "Reference image payload",
  );
}

export function validateReferenceImagePlacement(
  value: unknown,
): ContractValidationResult<ReferenceImagePlacement> {
  const result = validateContract(referenceImagePlacementValidator, value);
  if (!result.success) {
    return result;
  }

  const invariantIssues = validateReferenceImagePlacementInvariants(
    result.data,
  );
  return invariantIssues.length === 0
    ? result
    : {
        success: false,
        data: result.data,
        issues: invariantIssues,
      };
}

export function validateReferenceImageCalibrationAnchor(
  value: unknown,
): ContractValidationResult<ReferenceImageCalibrationAnchor> {
  const result = validateContract(referenceImageCalibrationAnchorValidator, value);
  if (!result.success) {
    return result;
  }

  const invariantIssues = validateReferenceImageCalibrationAnchorInvariants(
    result.data,
  );
  return invariantIssues.length === 0
    ? result
    : {
        success: false,
        data: result.data,
        issues: invariantIssues,
      };
}

export function validateReferenceImageCalibrationState(
  value: unknown,
): ContractValidationResult<ReferenceImageCalibrationState> {
  const result = validateContract(referenceImageCalibrationStateValidator, value);
  if (!result.success) {
    return result;
  }

  const invariantIssues = validateReferenceImageCalibrationStateInvariants(
    result.data,
  );
  return invariantIssues.length === 0
    ? result
    : {
        success: false,
        data: result.data,
        issues: invariantIssues,
      };
}

export function validateReferenceImageOperationState(
  value: unknown,
): ContractValidationResult<ReferenceImageOperationState> {
  const result = validateContract(referenceImageOperationStateValidator, value);
  if (!result.success) {
    return result;
  }

  const invariantIssues = validateReferenceImageOperationStateInvariants(
    result.data,
  );
  return invariantIssues.length === 0
    ? result
    : {
        success: false,
        data: result.data,
        issues: invariantIssues,
      };
}

export function requireReferenceImageOperationState(
  value: unknown,
): ReferenceImageOperationState {
  return requireValidationResult(
    validateReferenceImageOperationState(value),
    value,
    "Reference image operation state",
  );
}

export function validateReferenceImageOperationStateInvariants(
  state: ReferenceImageOperationState,
): ContractValidationIssue[] {
  return [
    ...prefixIssues("image", validateReferenceImagePayloadInvariants(state.image)),
    ...prefixIssues(
      "placement",
      validateReferenceImagePlacementInvariants(state.placement),
    ),
    ...(state.calibration
      ? prefixIssues(
          "calibration",
          validateReferenceImageCalibrationStateInvariants(state.calibration),
        )
      : []),
  ];
}

function validateReferenceImagePayloadInvariants(
  payload: ReferenceImagePayload,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];

  if (payload.mediaType.trim().length === 0) {
    issues.push({
      path: "mediaType",
      expected: "non-empty media type",
      value: payload.mediaType,
      message: "Reference-image media type must not be empty.",
    });
  }

  if (
    !Number.isInteger(payload.pixelWidth) ||
    payload.pixelWidth <= 0
  ) {
    issues.push({
      path: "pixelWidth",
      expected: "positive integer",
      value: payload.pixelWidth,
      message: "Reference-image pixel width must be a positive integer.",
    });
  }

  if (
    !Number.isInteger(payload.pixelHeight) ||
    payload.pixelHeight <= 0
  ) {
    issues.push({
      path: "pixelHeight",
      expected: "positive integer",
      value: payload.pixelHeight,
      message: "Reference-image pixel height must be a positive integer.",
    });
  }

  if (payload.base64Data.trim().length === 0) {
    issues.push({
      path: "base64Data",
      expected: "non-empty base64 string",
      value: payload.base64Data,
      message: "Reference-image base64 payload must not be empty.",
    });
  }

  if (payload.fileName !== undefined && payload.fileName.trim().length === 0) {
    issues.push({
      path: "fileName",
      expected: "non-empty file name",
      value: payload.fileName,
      message: "Reference-image file name must not be empty when present.",
    });
  }

  return issues;
}

function validateReferenceImagePlacementInvariants(
  placement: ReferenceImagePlacement,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];

  placement.center.forEach((coordinate, index) => {
    if (!Number.isFinite(coordinate)) {
      issues.push({
        path: `center.${index}`,
        expected: "finite number",
        value: coordinate,
        message: "Reference-image placement center must contain finite numbers.",
      });
    }
  });

  if (!Number.isFinite(placement.width) || placement.width <= 0) {
    issues.push({
      path: "width",
      expected: "positive finite number",
      value: placement.width,
      message: "Reference-image width must be positive.",
    });
  }

  if (!Number.isFinite(placement.height) || placement.height <= 0) {
    issues.push({
      path: "height",
      expected: "positive finite number",
      value: placement.height,
      message: "Reference-image height must be positive.",
    });
  }

  if (!Number.isFinite(placement.rotationRadians)) {
    issues.push({
      path: "rotationRadians",
      expected: "finite number",
      value: placement.rotationRadians,
      message: "Reference-image rotation must be finite.",
    });
  }

  return issues;
}

function validateReferenceImageCalibrationAnchorInvariants(
  anchor: ReferenceImageCalibrationAnchor,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];

  if (anchor.anchorId.trim().length === 0) {
    issues.push({
      path: "anchorId",
      expected: "non-empty anchor id",
      value: anchor.anchorId,
      message: "Reference-image calibration anchor id must not be empty.",
    });
  }

  if (anchor.label.trim().length === 0) {
    issues.push({
      path: "label",
      expected: "non-empty label",
      value: anchor.label,
      message: "Reference-image calibration anchor label must not be empty.",
    });
  }

  anchor.uv.forEach((coordinate, index) => {
    if (
      !Number.isFinite(coordinate) ||
      coordinate < 0 ||
      coordinate > 1
    ) {
      issues.push({
        path: `uv.${index}`,
        expected: "number from 0 to 1",
        value: coordinate,
        message:
          "Reference-image calibration anchor UV coordinates must stay within image bounds.",
      });
    }
  });

  if (anchor.pointId.trim().length === 0) {
    issues.push({
      path: "pointId",
      expected: "non-empty point id",
      value: anchor.pointId,
      message: "Reference-image calibration anchor point id must not be empty.",
    });
  }

  return issues;
}

function validateReferenceImageCalibrationStateInvariants(
  state: ReferenceImageCalibrationState,
): ContractValidationIssue[] {
  const issues = state.anchors.flatMap((anchor, index) =>
    prefixIssues(
      `anchors.${index}`,
      validateReferenceImageCalibrationAnchorInvariants(anchor),
    ),
  );
  const anchorIds = new Set<string>();

  state.anchors.forEach((anchor, index) => {
    if (anchorIds.has(anchor.anchorId)) {
      issues.push({
        path: `anchors.${index}.anchorId`,
        expected: "unique anchor id",
        value: anchor.anchorId,
        message: "Reference-image calibration anchor ids must be unique.",
      });
    }
    anchorIds.add(anchor.anchorId);
  });

  return issues;
}

function prefixIssues(
  prefix: string,
  issues: readonly ContractValidationIssue[],
): ContractValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path ? `${prefix}.${issue.path}` : prefix,
  }));
}

function requireValidationResult<T>(
  result: ContractValidationResult<T>,
  value: unknown,
  label: string,
): T {
  if (result.success) {
    return result.data;
  }

  const firstIssue = result.issues[0];
  throw new ContractValidationError(
    firstIssue?.message ?? `${label} validation failed.`,
    value,
    result.issues,
  );
}
