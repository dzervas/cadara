import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import { createDefinitionValidationContext } from "./definition-validation-context";
import { derivedShellRequirementDiagnostics } from "./derived-requirement-diagnostics";
import type {
  SketchCoreValidationResult,
  SketchSolveTolerancePolicy,
} from "./solve-types";
import { makeDiagnostic } from "./solver-geometry";
import { validateConstraintRecord } from "./validate-constraint-record";
import { validateDimensionRecord } from "./validate-dimension-record";
import { validateEntityRecord } from "./validate-entity-record";

export function validateDefinition(
  definition: SketchDefinition,
  tolerances: SketchSolveTolerancePolicy,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
): SketchCoreValidationResult {
  const context = createDefinitionValidationContext(
    definition,
    tolerances,
    projectedReferences,
  );
  const {
    diagnostics,
    authoredStyleIds,
    authoredStyles,
    pointIds,
    entityIds,
    constraintIds,
    dimensionIds,
    referenceIds,
    styleIds,
    pointMap,
    entityMap,
    constraintMap,
    dimensionMap,
    referenceMap,
    styleMap,
  } = context;

  for (const pointId of definition.pointIds) {
    if (pointIds.has(pointId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-point-id",
          "error",
          `Point ${pointId} appears more than once.`,
          { kind: "point", pointId },
        ),
      );
    }
    pointIds.add(pointId);
  }

  for (const entityId of definition.entityIds) {
    if (entityIds.has(entityId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-entity-id",
          "error",
          `Entity ${entityId} appears more than once.`,
          { kind: "entity", entityId },
        ),
      );
    }
    entityIds.add(entityId);
  }

  for (const constraintId of definition.constraintIds) {
    if (constraintIds.has(constraintId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-constraint-id",
          "error",
          `Constraint ${constraintId} appears more than once.`,
          { kind: "constraint", constraintId },
        ),
      );
    }
    constraintIds.add(constraintId);
  }

  for (const dimensionId of definition.dimensionIds) {
    if (dimensionIds.has(dimensionId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-dimension-id",
          "error",
          `Dimension ${dimensionId} appears more than once.`,
          { kind: "dimension", dimensionId },
        ),
      );
    }
    dimensionIds.add(dimensionId);
  }

  for (const referenceId of definition.referenceIds) {
    if (referenceIds.has(referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-reference-id",
          "error",
          `Reference ${referenceId} appears more than once.`,
          null,
        ),
      );
    }
    referenceIds.add(referenceId);
  }

  for (const styleId of authoredStyleIds) {
    if (styleIds.has(styleId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-style-id",
          "error",
          `Style ${styleId} appears more than once.`,
          null,
        ),
      );
    }
    styleIds.add(styleId);
  }

  for (const entity of definition.entities) {
    validateEntityRecord(context, entity);
  }

  for (const point of definition.points) {
    if (!pointIds.has(point.pointId)) {
      diagnostics.push(
        makeDiagnostic(
          "point-missing-from-order",
          "error",
          `Point ${point.pointId} is not listed in pointIds.`,
          { kind: "point", pointId: point.pointId },
        ),
      );
    }
  }

  for (const pointId of definition.pointIds) {
    if (!pointMap.has(pointId)) {
      diagnostics.push(
        makeDiagnostic(
          "point-missing-from-records",
          "error",
          `pointIds references missing point ${pointId}.`,
          { kind: "point", pointId },
        ),
      );
    }
  }

  for (const entityId of definition.entityIds) {
    if (!entityMap.has(entityId)) {
      diagnostics.push(
        makeDiagnostic(
          "entity-missing-from-records",
          "error",
          `entityIds references missing entity ${entityId}.`,
          { kind: "entity", entityId },
        ),
      );
    }
  }

  for (const constraint of definition.constraints) {
    validateConstraintRecord(context, constraint);
  }

  for (const constraintId of definition.constraintIds) {
    if (!constraintMap.has(constraintId)) {
      diagnostics.push(
        makeDiagnostic(
          "constraint-missing-from-records",
          "error",
          `constraintIds references missing constraint ${constraintId}.`,
          { kind: "constraint", constraintId },
        ),
      );
    }
  }

  for (const dimension of definition.dimensions) {
    validateDimensionRecord(context, dimension);
  }

  for (const dimensionId of definition.dimensionIds) {
    if (!dimensionMap.has(dimensionId)) {
      diagnostics.push(
        makeDiagnostic(
          "dimension-missing-from-records",
          "error",
          `dimensionIds references missing dimension ${dimensionId}.`,
          { kind: "dimension", dimensionId },
        ),
      );
    }
  }

  for (const reference of definition.references) {
    if (!referenceIds.has(reference.referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "reference-missing-from-order",
          "error",
          `Reference ${reference.referenceId} is not listed in referenceIds.`,
          null,
        ),
      );
    }
  }

  for (const referenceId of definition.referenceIds) {
    if (!referenceMap.has(referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "reference-missing-from-records",
          "error",
          `referenceIds references missing reference ${referenceId}.`,
          null,
        ),
      );
    }
  }

  for (const style of authoredStyles) {
    if (!styleIds.has(style.styleId)) {
      diagnostics.push(
        makeDiagnostic(
          "style-missing-from-order",
          "error",
          `Style ${style.styleId} is not listed in styleIds.`,
          null,
        ),
      );
    }
  }

  for (const styleId of authoredStyleIds) {
    if (!styleMap.has(styleId)) {
      diagnostics.push(
        makeDiagnostic(
          "style-missing-from-records",
          "error",
          `styleIds references missing style ${styleId}.`,
          null,
        ),
      );
    }
  }

  diagnostics.push(...derivedShellRequirementDiagnostics(definition));

  return {
    isValid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics,
  };
}
