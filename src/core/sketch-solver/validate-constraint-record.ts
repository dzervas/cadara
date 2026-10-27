import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import {
  isAdvancedSketchEntity,
  splineArcEndpointTangency,
} from "./arc-geometry";
import type { DefinitionValidationContext } from "./definition-validation-context";
import { findProjectedGeometry, unitVector } from "./projected-geometry";
import { length, makeDiagnostic, subtract } from "./solver-geometry";
export function validateConstraintRecord(
  context: DefinitionValidationContext,
  constraint: SketchDefinition["constraints"][number],
): void {
  const {
    definition,
    projectedReferences,
    diagnostics,
    constraintIds,
    pointMap,
    entityMap,
    validateDatumConstraintTarget,
    validateProjectedTarget,
  } = context;

  if (!constraintIds.has(constraint.constraintId)) {
    diagnostics.push(
      makeDiagnostic(
        "constraint-missing-from-order",
        "error",
        `Constraint ${constraint.constraintId} is not listed in constraintIds.`,
        { kind: "constraint", constraintId: constraint.constraintId },
      ),
    );
  }

  switch (constraint.kind) {
    case "coincident":
      if (
        !pointMap.has(constraint.pointIds[0]) ||
        !pointMap.has(constraint.pointIds[1])
      ) {
        diagnostics.push(
          makeDiagnostic(
            "missing-coincident-point",
            "error",
            `‘${constraint.label}’ references a point that no longer exists.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    case "horizontal":
    case "vertical":
      if (entityMap.get(constraint.entityId)?.kind !== "lineSegment") {
        diagnostics.push(
          makeDiagnostic(
            entityMap.has(constraint.entityId)
              ? "unsupported-constraint-operands"
              : "missing-constrained-entity",
            "error",
            entityMap.has(constraint.entityId)
              ? `‘${constraint.label}’ has an unsupported operand combination: requires a local line.`
              : `‘${constraint.label}’ references geometry that no longer exists.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    case "fixPoint":
      if (!pointMap.has(constraint.pointId)) {
        diagnostics.push(
          makeDiagnostic(
            "missing-fix-point",
            "error",
            `‘${constraint.label}’ references a point that no longer exists.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    case "angle":
      if (!constraint.pointIds.every((pointId) => pointMap.has(pointId))) {
        diagnostics.push(
          makeDiagnostic(
            "missing-angle-point",
            "error",
            `‘${constraint.label}’ references a point that no longer exists.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    case "equalOffset": {
      const pairEntities = constraint.pairs.flatMap((pair) => [
        entityMap.get(pair.seedEntityId),
        entityMap.get(pair.offsetEntityId),
      ]);
      const hasInvalidOperands =
        pairEntities.some((entity) => entity?.kind !== "lineSegment") ||
        constraint.pairs.some(
          (pair) => pair.seedEntityId === pair.offsetEntityId,
        );
      if (hasInvalidOperands) {
        diagnostics.push(
          makeDiagnostic(
            "invalid-equal-offset-line-pair",
            "error",
            `‘${constraint.label}’ requires two distinct seed/offset line pairs.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      } else if (
        pairEntities.some((entity) => {
          if (entity?.kind !== "lineSegment") return false;
          const start = pointMap.get(entity.startPointId);
          const end = pointMap.get(entity.endPointId);
          return (
            start !== undefined &&
            end !== undefined &&
            !Number.isFinite(length(subtract(start.position, end.position)))
          );
        })
      ) {
        diagnostics.push(
          makeDiagnostic(
            "non-finite-equal-offset-geometry",
            "error",
            `‘${constraint.label}’ cannot evaluate non-finite line geometry.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    }
    case "equalLength": {
      const [a, b] = constraint.entityIds.map((id) => entityMap.get(id));
      // Circle↔circle only: arc radius also depends on endpoints and is not
      // part of the scalar-circle equality contract. Never silently skip it.
      if (
        !a ||
        !b ||
        a.kind !== b.kind ||
        (a.kind !== "lineSegment" && a.kind !== "circle")
      ) {
        diagnostics.push(
          makeDiagnostic(
            "unsupported-equal-operands",
            "error",
            `‘${constraint.label}’ requires two local lines or two local circles (not arcs).`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    }
    case "parallel":
    case "perpendicular":
      if (
        !constraint.entityIds.every(
          (entityId) => entityMap.get(entityId)?.kind === "lineSegment",
        )
      ) {
        diagnostics.push(
          makeDiagnostic(
            constraint.entityIds.every((id) => entityMap.has(id))
              ? "unsupported-constraint-operands"
              : "missing-two-line-entity",
            "error",
            constraint.entityIds.every((id) => entityMap.has(id))
              ? `‘${constraint.label}’ has an unsupported operand combination: requires two local lines.`
              : `‘${constraint.label}’ references geometry that no longer exists.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    case "coincidentProjectedPoint":
      if (!pointMap.has(constraint.point.pointId)) {
        diagnostics.push(
          makeDiagnostic(
            "missing-coincident-point",
            "error",
            `‘${constraint.label}’ references a point that no longer exists.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      if (constraint.projectedPoint.kind === "projectedGeometry") {
        validateProjectedTarget(
          constraint.constraintId,
          constraint.projectedPoint.reference,
          ["projectedPoint"],
        );
      } else {
        validateDatumConstraintTarget(
          constraint.constraintId,
          constraint.projectedPoint.datum,
          ["origin"],
        );
      }
      break;
    case "midpoint": {
      const entity = entityMap.get(constraint.line.entityId);
      if (
        !pointMap.has(constraint.point.pointId) ||
        !entity ||
        entity.kind !== "lineSegment"
      ) {
        diagnostics.push(
          makeDiagnostic(
            "missing-midpoint-target",
            "error",
            `‘${constraint.label}’ references a point or line that no longer exists.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    }
    case "midpointProjectedLine":
      if (!pointMap.has(constraint.point.pointId)) {
        diagnostics.push(
          makeDiagnostic(
            "missing-projected-midpoint-point",
            "error",
            `‘${constraint.label}’ references a point that no longer exists.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      if (constraint.projectedLine.kind === "projectedGeometry") {
        validateProjectedTarget(
          constraint.constraintId,
          constraint.projectedLine.reference,
          ["projectedLineSegment"],
        );
      } else {
        validateDatumConstraintTarget(
          constraint.constraintId,
          constraint.projectedLine.datum,
          ["axis"],
        );
      }
      break;
    case "pointOnCurve": {
      const entity = entityMap.get(constraint.curve.entityId);
      if (!pointMap.has(constraint.point.pointId) || !entity) {
        diagnostics.push(
          makeDiagnostic(
            "missing-point-on-curve-target",
            "error",
            `‘${constraint.label}’ references a point or curve that no longer exists.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      } else if (isAdvancedSketchEntity(entity)) {
        diagnostics.push(
          makeDiagnostic(
            "unsupported-solver-entity-constraint",
            "error",
            `‘${constraint.label}’ targets ${entity.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      } else if (
        entity.kind !== "lineSegment" &&
        entity.kind !== "circle" &&
        entity.kind !== "arc" &&
        entity.kind !== "spline" &&
        entity.kind !== "derivedPiecewiseCubic"
      ) {
        diagnostics.push(
          makeDiagnostic(
            "missing-point-on-curve-target",
            "error",
            `‘${constraint.label}’ references a point or curve that no longer exists.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    }
    case "collinear": {
      const targetEntity =
        constraint.target.kind === "localEntity"
          ? entityMap.get(constraint.target.entityId)
          : null;
      const reference = entityMap.get(constraint.line.entityId);
      if (
        (constraint.target.kind === "localPoint" &&
          !pointMap.has(constraint.target.pointId)) ||
        (constraint.target.kind === "localEntity" &&
          targetEntity?.kind !== "lineSegment") ||
        reference?.kind !== "lineSegment"
      ) {
        diagnostics.push(
          makeDiagnostic(
            "missing-collinear-target",
            "error",
            `‘${constraint.label}’ references a collinear target that no longer exists or is not supported.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    }
    case "collinearProjectedLine": {
      const targetEntity =
        constraint.target.kind === "localEntity"
          ? entityMap.get(constraint.target.entityId)
          : null;
      if (
        (constraint.target.kind === "localPoint" &&
          !pointMap.has(constraint.target.pointId)) ||
        (constraint.target.kind === "localEntity" &&
          targetEntity?.kind !== "lineSegment")
      ) {
        diagnostics.push(
          makeDiagnostic(
            "missing-projected-collinear-local-target",
            "error",
            `‘${constraint.label}’ references a collinear target that no longer exists or is not supported.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      if (constraint.projectedLine.kind === "projectedGeometry") {
        validateProjectedTarget(
          constraint.constraintId,
          constraint.projectedLine.reference,
          ["projectedLineSegment"],
        );
      } else {
        validateDatumConstraintTarget(
          constraint.constraintId,
          constraint.projectedLine.datum,
          ["axis"],
        );
      }
      break;
    }
    case "pointOnProjectedCurve":
      if (!pointMap.has(constraint.point.pointId)) {
        diagnostics.push(
          makeDiagnostic(
            "missing-point-on-projected-curve-point",
            "error",
            `‘${constraint.label}’ references a point that no longer exists.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      if (constraint.projectedCurve.kind === "projectedGeometry") {
        validateProjectedTarget(
          constraint.constraintId,
          constraint.projectedCurve.reference,
          [
            "projectedLineSegment",
            "projectedCircle",
            "projectedArc",
            "projectedSpline",
          ],
        );
        const projected = findProjectedGeometry(
          projectedReferences,
          constraint.projectedCurve.reference,
        );
        if (
          projected?.kind === "spline" &&
          projected.representation.kind === "sourceSamples"
        ) {
          diagnostics.push(
            makeDiagnostic(
              "unsupported-projected-spline-samples",
              "error",
              `‘${constraint.label}’ targets sampled projected spline geometry, which is display-only and cannot define an exact solver constraint.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
      } else {
        validateDatumConstraintTarget(
          constraint.constraintId,
          constraint.projectedCurve.datum,
          ["axis"],
        );
      }
      break;
    case "parallelProjectedLine":
    case "perpendicularProjectedLine": {
      const entity = entityMap.get(constraint.line.entityId);
      if (!entity || entity.kind !== "lineSegment") {
        diagnostics.push(
          makeDiagnostic(
            "missing-projected-line-local-entity",
            "error",
            `‘${constraint.label}’ references a line that no longer exists or is not supported.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      if (constraint.projectedLine.kind === "projectedGeometry") {
        validateProjectedTarget(
          constraint.constraintId,
          constraint.projectedLine.reference,
          ["projectedLineSegment"],
        );
      } else {
        validateDatumConstraintTarget(
          constraint.constraintId,
          constraint.projectedLine.datum,
          ["axis"],
        );
      }
      if (constraint.projectedLine.kind === "projectedGeometry") {
        const projected = findProjectedGeometry(
          projectedReferences,
          constraint.projectedLine.reference,
        );
        if (
          projected?.kind === "lineSegment" &&
          !unitVector(projected.startPosition, projected.endPosition)
        ) {
          diagnostics.push(
            makeDiagnostic(
              "unsupported-constraint-operands",
              "error",
              `‘${constraint.label}’ has an unsupported operand combination: a projected line must have a nonzero direction.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
      }
      break;
    }
    case "tangentProjectedCurve": {
      const entity = entityMap.get(constraint.curve.entityId);
      if (!entity) {
        diagnostics.push(
          makeDiagnostic(
            "missing-projected-tangent-local-curve",
            "error",
            `‘${constraint.label}’ references a curve that no longer exists or is not supported.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      } else if (isAdvancedSketchEntity(entity)) {
        diagnostics.push(
          makeDiagnostic(
            "unsupported-solver-entity-constraint",
            "error",
            `‘${constraint.label}’ targets ${entity.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      } else if (
        entity.kind !== "lineSegment" &&
        entity.kind !== "circle" &&
        entity.kind !== "arc"
      ) {
        diagnostics.push(
          makeDiagnostic(
            "missing-projected-tangent-local-curve",
            "error",
            `‘${constraint.label}’ references a curve that no longer exists or is not supported.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      validateProjectedTarget(
        constraint.constraintId,
        constraint.projectedCurve.reference,
        ["projectedCircle", "projectedArc"],
      );
      break;
    }
    case "tangent": {
      const entities = constraint.entityIds.map((entityId) =>
        entityMap.get(entityId),
      );
      if (entities.some((entity) => entity && isAdvancedSketchEntity(entity))) {
        diagnostics.push(
          makeDiagnostic(
            "unsupported-solver-entity-constraint",
            "error",
            `‘${constraint.label}’ targets an advanced sketch entity that is not supported by the current solver constraint set.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      } else if (
        !splineArcEndpointTangency(definition, entities[0], entities[1]) &&
        !entities.every(
          (entity) =>
            entity &&
            (entity.kind === "lineSegment" ||
              entity.kind === "circle" ||
              entity.kind === "arc"),
        )
      ) {
        diagnostics.push(
          makeDiagnostic(
            "missing-tangent-entity",
            "error",
            `‘${constraint.label}’ references a curve that no longer exists or is not supported.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      if (entities.every((entity) => entity?.kind === "lineSegment")) {
        diagnostics.push(
          makeDiagnostic(
            "unsupported-constraint-operands",
            "error",
            `‘${constraint.label}’ has an unsupported operand combination: Tangent needs a circle or arc.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    }
    case "concentric": {
      const entities = constraint.entityIds.map((entityId) =>
        entityMap.get(entityId),
      );
      if (entities.some((entity) => entity && isAdvancedSketchEntity(entity))) {
        diagnostics.push(
          makeDiagnostic(
            "unsupported-solver-entity-constraint",
            "error",
            `‘${constraint.label}’ targets an advanced sketch entity that is not supported by the current solver constraint set.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      } else if (
        !entities.every(
          (entity) =>
            entity && (entity.kind === "circle" || entity.kind === "arc"),
        )
      ) {
        diagnostics.push(
          makeDiagnostic(
            "missing-concentric-entity",
            "error",
            `‘${constraint.label}’ references a circle or arc that no longer exists or is not supported.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    }
    case "concentricProjectedCurve": {
      const entity = entityMap.get(constraint.curve.entityId);
      if (!entity) {
        diagnostics.push(
          makeDiagnostic(
            "missing-projected-concentric-local-curve",
            "error",
            `‘${constraint.label}’ references a circle or arc that no longer exists or is not supported.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      } else if (isAdvancedSketchEntity(entity)) {
        diagnostics.push(
          makeDiagnostic(
            "unsupported-solver-entity-constraint",
            "error",
            `‘${constraint.label}’ targets ${entity.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      } else if (entity.kind !== "circle" && entity.kind !== "arc") {
        diagnostics.push(
          makeDiagnostic(
            "missing-projected-concentric-local-curve",
            "error",
            `‘${constraint.label}’ references a circle or arc that no longer exists or is not supported.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      validateProjectedTarget(
        constraint.constraintId,
        constraint.projectedCurve.reference,
        ["projectedCircle", "projectedArc"],
      );
      break;
    }
    case "normal": {
      const line = entityMap.get(constraint.line.entityId);
      const curve = entityMap.get(constraint.curve.entityId);
      if (
        !pointMap.has(constraint.point.pointId) ||
        !line ||
        line.kind !== "lineSegment" ||
        !curve ||
        isAdvancedSketchEntity(curve) ||
        (curve.kind !== "circle" && curve.kind !== "arc")
      ) {
        diagnostics.push(
          makeDiagnostic(
            curve && isAdvancedSketchEntity(curve)
              ? "unsupported-solver-entity-constraint"
              : "missing-normal-target",
            "error",
            curve && isAdvancedSketchEntity(curve)
              ? `‘${constraint.label}’ targets ${curve.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`
              : `‘${constraint.label}’ references a normal target that no longer exists or is not supported.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    }
    case "normalProjectedCurve": {
      const line = entityMap.get(constraint.line.entityId);
      if (
        !pointMap.has(constraint.point.pointId) ||
        !line ||
        line.kind !== "lineSegment"
      ) {
        diagnostics.push(
          makeDiagnostic(
            "missing-projected-normal-local-target",
            "error",
            `‘${constraint.label}’ references a normal line or point that no longer exists.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      validateProjectedTarget(
        constraint.constraintId,
        constraint.projectedCurve.reference,
        ["projectedCircle", "projectedArc"],
      );
      break;
    }
    case "symmetric": {
      const axis = entityMap.get(constraint.axis.entityId);
      if (
        !constraint.pointIds.every((pointId) => pointMap.has(pointId)) ||
        !axis ||
        axis.kind !== "lineSegment"
      ) {
        diagnostics.push(
          makeDiagnostic(
            "missing-symmetric-target",
            "error",
            `‘${constraint.label}’ references points or a symmetry axis that no longer exist.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      break;
    }
    case "symmetricProjectedLine":
      if (!constraint.pointIds.every((pointId) => pointMap.has(pointId))) {
        diagnostics.push(
          makeDiagnostic(
            "missing-projected-symmetric-point",
            "error",
            `‘${constraint.label}’ references symmetric points that no longer exist.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ),
        );
      }
      if (constraint.projectedLine.kind === "projectedGeometry") {
        validateProjectedTarget(
          constraint.constraintId,
          constraint.projectedLine.reference,
          ["projectedLineSegment"],
        );
      } else {
        validateDatumConstraintTarget(
          constraint.constraintId,
          constraint.projectedLine.datum,
          ["axis"],
        );
      }
      break;
  }
}
