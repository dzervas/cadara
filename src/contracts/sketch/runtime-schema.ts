import typia from "typia";

import type {
  ProjectedSketchGeometryRef,
  RegionRecord,
  SketchDefinition,
  SketchRecord,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type {
  SketchEntityRef,
  SketchPointRef,
} from "@/contracts/shared/references";
import type { RequestId } from "@/contracts/shared/ids";
import {
  ContractValidationError,
  validateContract,
  type ContractValidationIssue,
  type ContractValidationResult,
} from "@/contracts/shared/validation";
import { validateReferenceImageOperationStateInvariants } from "@/contracts/reference-image/runtime-schema";

export type ProjectedReferenceRequestTarget =
  | ProjectedSketchGeometryRef
  | SketchEntityRef
  | SketchPointRef;

const sketchDefinitionValidator =
  typia.createValidateEquals<SketchDefinition>();
const sketchRecordValidator = typia.createValidateEquals<SketchRecord>();
const solvedSketchSnapshotValidator =
  typia.createValidateEquals<SolvedSketchSnapshot>();
const projectedReferenceRequestTargetValidator =
  typia.createValidateEquals<ProjectedReferenceRequestTarget>();
const solverRegionRecordValidator = typia.createValidateEquals<RegionRecord>();
const solverRequestIdValidator = typia.createValidateEquals<RequestId>();

export function validateSketchDefinition(
  value: unknown,
): ContractValidationResult<SketchDefinition> {
  const result = validateContract(sketchDefinitionValidator, value);
  if (!result.success) {
    return result;
  }

  const invariantIssues = validateSketchDefinitionInvariants(result.data);
  return invariantIssues.length === 0
    ? result
    : {
        success: false,
        data: result.data,
        issues: invariantIssues,
      };
}

export function requireSketchDefinition(value: unknown): SketchDefinition {
  return requireValidationResult(
    validateSketchDefinition(value),
    value,
    "Sketch definition",
  );
}

export function validateSketchRecord(
  value: unknown,
): ContractValidationResult<SketchRecord> {
  const result = validateContract(sketchRecordValidator, value);
  if (!result.success) {
    return result;
  }

  const invariantIssues = [
    ...prefixIssues(
      "definition",
      validateSketchDefinitionInvariants(result.data.definition),
    ),
    ...prefixIssues(
      "solvedSnapshot",
      validateSolvedSketchSnapshotInvariants(result.data.solvedSnapshot),
    ),
  ];
  return invariantIssues.length === 0
    ? result
    : {
        success: false,
        data: result.data,
        issues: invariantIssues,
      };
}

export function requireSketchRecord(value: unknown): SketchRecord {
  return requireValidationResult(
    validateSketchRecord(value),
    value,
    "Sketch record",
  );
}

export function validateSolvedSketchSnapshot(
  value: unknown,
): ContractValidationResult<SolvedSketchSnapshot> {
  const result = validateContract(solvedSketchSnapshotValidator, value);
  if (!result.success) {
    return result;
  }

  const invariantIssues = validateSolvedSketchSnapshotInvariants(result.data);
  return invariantIssues.length === 0
    ? result
    : {
        success: false,
        data: result.data,
        issues: invariantIssues,
      };
}

export function requireSolvedSketchSnapshot(
  value: unknown,
): SolvedSketchSnapshot {
  return requireValidationResult(
    validateSolvedSketchSnapshot(value),
    value,
    "Solved sketch snapshot",
  );
}

export function validateProjectedReferenceRequestTarget(
  value: unknown,
): ContractValidationResult<ProjectedReferenceRequestTarget> {
  return validateContract(projectedReferenceRequestTargetValidator, value);
}

export function validateSolverRegionRecord(
  value: unknown,
): ContractValidationResult<RegionRecord> {
  return validateContract(solverRegionRecordValidator, value);
}

export function validateSolverRequestId(
  value: unknown,
): ContractValidationResult<RequestId> {
  return validateContract(solverRequestIdValidator, value);
}

function validateSketchDefinitionInvariants(definition: SketchDefinition) {
  const issues: {
    path: string;
    expected: string;
    value: unknown;
    message: string;
  }[] = [];

  definition.entities.forEach((entity, index) => {
    if (entity.kind === "circle" && entity.radius <= 0) {
      issues.push({
        path: `entities.${index}.radius`,
        expected: "positive number",
        value: entity.radius,
        message: "Sketch circle radius must be positive.",
      });
    }

    if ("minorRadius" in entity && entity.minorRadius <= 0) {
      issues.push({
        path: `entities.${index}.minorRadius`,
        expected: "positive number",
        value: entity.minorRadius,
        message: "Sketch entity minor radius must be positive.",
      });
    }

    if (entity.kind === "conic" && entity.rho <= 0) {
      issues.push({
        path: `entities.${index}.rho`,
        expected: "positive number",
        value: entity.rho,
        message: "Sketch conic rho must be positive.",
      });
    }

    if (entity.kind === "profileText") {
      if (entity.text.trim().length === 0) {
        issues.push({
          path: `entities.${index}.text`,
          expected: "non-empty text",
          value: entity.text,
          message: "Sketch profile text must not be empty.",
        });
      }

      if (entity.height <= 0) {
        issues.push({
          path: `entities.${index}.height`,
          expected: "positive number",
          value: entity.height,
          message: "Sketch profile text height must be positive.",
        });
      }
    }
  });

  definition.authoringOperations?.forEach((operation, index) => {
    const state = operation.ownedState;
    if (state?.kind !== "referenceImage") {
      return;
    }

    issues.push(
      ...prefixIssues(
        `authoringOperations.${index}.ownedState`,
        validateReferenceImageOperationStateInvariants(state),
      ),
    );

    const hasOperationTarget =
      operation.kind === "referenceImage" ||
      (operation.kind === "edit" &&
        operation.targets.edited?.some((t) => t.kind === "operation"));

    if (!hasOperationTarget) {
      issues.push({
        path: `authoringOperations.${index}.ownedState`,
        expected: "referenceImage or edit-with-operation-target",
        value: operation.kind,
        message:
          operation.kind === "edit"
            ? "Edit operations without operation targets should not have operation-owned reference-image state."
            : "Non-reference operations should not have operation-owned reference-image state.",
      });
      return;
    }

  });

  return issues;
}

function validateSolvedSketchSnapshotInvariants(
  snapshot: SolvedSketchSnapshot,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];

  snapshot.solvedEntities.forEach((entity, index) => {
    if (entity.kind === "circle" && entity.solvedRadius <= 0) {
      issues.push({
        path: `solvedEntities.${index}.solvedRadius`,
        expected: "positive number",
        value: entity.solvedRadius,
        message: "Solved sketch circle radius must be positive.",
      });
    }

    if ("minorRadius" in entity && entity.minorRadius <= 0) {
      issues.push({
        path: `solvedEntities.${index}.minorRadius`,
        expected: "positive number",
        value: entity.minorRadius,
        message: "Solved sketch entity minor radius must be positive.",
      });
    }

    if (entity.kind === "conic" && entity.rho <= 0) {
      issues.push({
        path: `solvedEntities.${index}.rho`,
        expected: "positive number",
        value: entity.rho,
        message: "Solved sketch conic rho must be positive.",
      });
    }

    if (entity.kind === "profileText") {
      if (entity.text.trim().length === 0) {
        issues.push({
          path: `solvedEntities.${index}.text`,
          expected: "non-empty text",
          value: entity.text,
          message: "Solved sketch profile text must not be empty.",
        });
      }

      if (entity.height <= 0) {
        issues.push({
          path: `solvedEntities.${index}.height`,
          expected: "positive number",
          value: entity.height,
          message: "Solved sketch profile text height must be positive.",
        });
      }
    }
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
