import typia from "typia";

import type {
  SketchPlaneDefinition,
  SketchPlaneFrame,
  SketchPlaneSupportRef,
} from "@/contracts/shared/sketch-plane";
import {
  requireContract,
  validateContract,
  type ContractValidationResult,
} from "@/contracts/shared/validation";

const sketchPlaneFrameValidator =
  typia.createValidateEquals<SketchPlaneFrame>();
const sketchPlaneSupportRefValidator =
  typia.createValidateEquals<SketchPlaneSupportRef>();
const sketchPlaneDefinitionValidator =
  typia.createValidateEquals<SketchPlaneDefinition>();

export function validateSketchPlaneFrame(
  value: unknown,
): ContractValidationResult<SketchPlaneFrame> {
  return validateContract(sketchPlaneFrameValidator, value);
}

export function requireSketchPlaneFrame(value: unknown): SketchPlaneFrame {
  return requireContract(
    sketchPlaneFrameValidator,
    value,
    "Sketch plane frame",
  );
}

export function validateSketchPlaneSupportRef(
  value: unknown,
): ContractValidationResult<SketchPlaneSupportRef> {
  return validateContract(sketchPlaneSupportRefValidator, value);
}

export function validateSketchPlaneDefinition(
  value: unknown,
): ContractValidationResult<SketchPlaneDefinition> {
  return validateContract(sketchPlaneDefinitionValidator, value);
}

export function requireSketchPlaneDefinition(
  value: unknown,
): SketchPlaneDefinition {
  return requireContract(
    sketchPlaneDefinitionValidator,
    value,
    "Sketch plane definition",
  );
}
