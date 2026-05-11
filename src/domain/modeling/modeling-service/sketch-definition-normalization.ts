import type {
  ConstraintDefinition,
  DimensionDefinition,
} from "@/contracts/sketch/schema";
import {
  normalizeDimensionAngleAnnotationPlacement,
  normalizeDimensionLineAnnotationPlacement,
  normalizeLocalEntityConstraintOperand,
  normalizeLocalPointConstraintOperand,
  normalizeProjectedGeometryConstraintOperand,
  normalizeSketchCurveConstraintOperand,
  normalizeSketchPointConstraintOperand,
} from "./normalization";
import {
  assertConstraintId,
  assertDimensionId,
  assertSketchEntityId,
  assertSketchPointId,
  isRecord,
  isString,
} from "./validation";

export function normalizeConstraintDefinitionCore(
  value: unknown,
): ConstraintDefinition {
  if (
    !isRecord(value) ||
    !isString(value.constraintId) ||
    !isString(value.kind) ||
    !isString(value.label)
  ) {
    throw new Error("Invalid constraint definition payload.");
  }

  if (value.kind === "coincident") {
    if (!Array.isArray(value.pointIds) || value.pointIds.length !== 2) {
      throw new Error("Invalid coincident constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "coincident",
      label: value.label,
      pointIds: [
        assertSketchPointId(value.pointIds[0]),
        assertSketchPointId(value.pointIds[1]),
      ],
    };
  }

  if (value.kind === "horizontal" || value.kind === "vertical") {
    if (!isString(value.entityId)) {
      throw new Error("Invalid axis constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: value.kind,
      label: value.label,
      entityId: assertSketchEntityId(value.entityId),
    };
  }

  if (value.kind === "fixPoint") {
    if (
      !isString(value.pointId) ||
      !Array.isArray(value.position) ||
      value.position.length !== 2 ||
      typeof value.position[0] !== "number" ||
      typeof value.position[1] !== "number"
    ) {
      throw new Error("Invalid fix point constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "fixPoint",
      label: value.label,
      pointId: assertSketchPointId(value.pointId),
      position: [value.position[0], value.position[1]],
    };
  }

  if (value.kind === "angle") {
    if (
      !Array.isArray(value.pointIds) ||
      value.pointIds.length !== 3 ||
      typeof value.valueRadians !== "number"
    ) {
      throw new Error("Invalid angle constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "angle",
      label: value.label,
      pointIds: [
        assertSketchPointId(value.pointIds[0]),
        assertSketchPointId(value.pointIds[1]),
        assertSketchPointId(value.pointIds[2]),
      ],
      valueRadians: value.valueRadians,
    };
  }

  if (
    value.kind === "parallel" ||
    value.kind === "perpendicular" ||
    value.kind === "equalLength" ||
    value.kind === "tangent" ||
    value.kind === "concentric"
  ) {
    if (!Array.isArray(value.entityIds) || value.entityIds.length !== 2) {
      throw new Error("Invalid two-line constraint payload.");
    }

    const constraintId = assertConstraintId(value.constraintId);
    const entityIds = [
      assertSketchEntityId(value.entityIds[0]),
      assertSketchEntityId(value.entityIds[1]),
    ] as const;
    const label = value.label;

    const base = {
      constraintId,
      label,
      entityIds,
    };

    if (value.kind === "tangent") {
      if (value.relation !== "external" && value.relation !== "internal") {
        throw new Error("Invalid tangent constraint payload.");
      }

      return {
        ...base,
        kind: "tangent",
        relation: value.relation,
      };
    }

    return {
      ...base,
      kind: value.kind,
    };
  }

  if (value.kind === "coincidentProjectedPoint") {
    if (!isRecord(value.point) || !isRecord(value.projectedPoint)) {
      throw new Error("Invalid projected coincident constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "coincidentProjectedPoint",
      label: value.label,
      point: normalizeLocalPointConstraintOperand(value.point),
      projectedPoint: normalizeProjectedGeometryConstraintOperand(
        value.projectedPoint,
      ),
    };
  }

  if (value.kind === "pointOnProjectedCurve") {
    if (!isRecord(value.point) || !isRecord(value.projectedCurve)) {
      throw new Error("Invalid point-on-projected-curve constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "pointOnProjectedCurve",
      label: value.label,
      point: normalizeLocalPointConstraintOperand(value.point),
      projectedCurve: normalizeProjectedGeometryConstraintOperand(
        value.projectedCurve,
      ),
    };
  }

  if (value.kind === "midpoint") {
    if (!isRecord(value.point) || !isRecord(value.line)) {
      throw new Error("Invalid midpoint constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "midpoint",
      label: value.label,
      point: normalizeLocalPointConstraintOperand(value.point),
      line: normalizeLocalEntityConstraintOperand(value.line),
    };
  }

  if (value.kind === "midpointProjectedLine") {
    if (!isRecord(value.point) || !isRecord(value.projectedLine)) {
      throw new Error("Invalid projected midpoint constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "midpointProjectedLine",
      label: value.label,
      point: normalizeLocalPointConstraintOperand(value.point),
      projectedLine: normalizeProjectedGeometryConstraintOperand(
        value.projectedLine,
      ),
    };
  }

  if (value.kind === "pointOnCurve") {
    if (!isRecord(value.point) || !isRecord(value.curve)) {
      throw new Error("Invalid point-on-curve constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "pointOnCurve",
      label: value.label,
      point: normalizeLocalPointConstraintOperand(value.point),
      curve: normalizeLocalEntityConstraintOperand(value.curve),
    };
  }

  if (
    value.kind === "parallelProjectedLine" ||
    value.kind === "perpendicularProjectedLine"
  ) {
    if (!isRecord(value.line) || !isRecord(value.projectedLine)) {
      throw new Error(
        "Invalid projected line relationship constraint payload.",
      );
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: value.kind,
      label: value.label,
      line: normalizeLocalEntityConstraintOperand(value.line),
      projectedLine: normalizeProjectedGeometryConstraintOperand(
        value.projectedLine,
      ),
    };
  }

  if (value.kind === "tangentProjectedCurve") {
    if (
      !isRecord(value.curve) ||
      !isRecord(value.projectedCurve) ||
      (value.relation !== "external" && value.relation !== "internal")
    ) {
      throw new Error("Invalid projected tangent constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "tangentProjectedCurve",
      label: value.label,
      curve: normalizeLocalEntityConstraintOperand(value.curve),
      projectedCurve: normalizeProjectedGeometryConstraintOperand(
        value.projectedCurve,
      ),
      relation: value.relation,
    };
  }

  if (value.kind === "concentricProjectedCurve") {
    if (!isRecord(value.curve) || !isRecord(value.projectedCurve)) {
      throw new Error("Invalid projected concentric constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "concentricProjectedCurve",
      label: value.label,
      curve: normalizeLocalEntityConstraintOperand(value.curve),
      projectedCurve: normalizeProjectedGeometryConstraintOperand(
        value.projectedCurve,
      ),
    };
  }

  if (value.kind === "normal") {
    if (
      !isRecord(value.line) ||
      !isRecord(value.curve) ||
      !isRecord(value.point)
    ) {
      throw new Error("Invalid normal constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "normal",
      label: value.label,
      line: normalizeLocalEntityConstraintOperand(value.line),
      curve: normalizeLocalEntityConstraintOperand(value.curve),
      point: normalizeLocalPointConstraintOperand(value.point),
    };
  }

  if (value.kind === "normalProjectedCurve") {
    if (
      !isRecord(value.line) ||
      !isRecord(value.projectedCurve) ||
      !isRecord(value.point)
    ) {
      throw new Error("Invalid projected normal constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "normalProjectedCurve",
      label: value.label,
      line: normalizeLocalEntityConstraintOperand(value.line),
      projectedCurve: normalizeProjectedGeometryConstraintOperand(
        value.projectedCurve,
      ),
      point: normalizeLocalPointConstraintOperand(value.point),
    };
  }

  if (value.kind === "symmetric") {
    if (
      !Array.isArray(value.pointIds) ||
      value.pointIds.length !== 2 ||
      !isRecord(value.axis)
    ) {
      throw new Error("Invalid symmetric constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "symmetric",
      label: value.label,
      pointIds: [
        assertSketchPointId(value.pointIds[0]),
        assertSketchPointId(value.pointIds[1]),
      ],
      axis: normalizeLocalEntityConstraintOperand(value.axis),
    };
  }

  if (value.kind === "symmetricProjectedLine") {
    if (
      !Array.isArray(value.pointIds) ||
      value.pointIds.length !== 2 ||
      !isRecord(value.projectedLine)
    ) {
      throw new Error("Invalid projected symmetric constraint payload.");
    }

    return {
      constraintId: assertConstraintId(value.constraintId),
      kind: "symmetricProjectedLine",
      label: value.label,
      pointIds: [
        assertSketchPointId(value.pointIds[0]),
        assertSketchPointId(value.pointIds[1]),
      ],
      projectedLine: normalizeProjectedGeometryConstraintOperand(
        value.projectedLine,
      ),
    };
  }

  throw new Error("Invalid constraint definition kind.");
}

export function normalizeDimensionDefinitionCore(
  value: unknown,
): DimensionDefinition {
  if (
    !isRecord(value) ||
    !isString(value.dimensionId) ||
    !isString(value.kind) ||
    !isString(value.label)
  ) {
    throw new Error("Invalid dimension definition payload.");
  }

  if (value.kind === "distance") {
    if (
      (value.axis !== "aligned" &&
        value.axis !== "horizontal" &&
        value.axis !== "vertical") ||
      !Array.isArray(value.pointIds) ||
      value.pointIds.length !== 2 ||
      typeof value.value !== "number"
    ) {
      throw new Error("Invalid distance dimension payload.");
    }

    return {
      dimensionId: assertDimensionId(value.dimensionId),
      kind: "distance",
      label: value.label,
      axis: value.axis,
      pointIds: [
        assertSketchPointId(value.pointIds[0]),
        assertSketchPointId(value.pointIds[1]),
      ],
      value: value.value,
      annotationPlacement: normalizeDimensionLineAnnotationPlacement(
        value.annotationPlacement,
      ),
    };
  }

  if (value.kind === "circleRadius") {
    if (!isString(value.entityId) || typeof value.value !== "number") {
      throw new Error("Invalid circle radius dimension payload.");
    }

    return {
      dimensionId: assertDimensionId(value.dimensionId),
      kind: "circleRadius",
      label: value.label,
      entityId: assertSketchEntityId(value.entityId),
      value: value.value,
      annotationPlacement: normalizeDimensionLineAnnotationPlacement(
        value.annotationPlacement,
      ),
    };
  }

  if (value.kind === "diameter") {
    if (!isString(value.entityId) || typeof value.value !== "number") {
      throw new Error("Invalid diameter dimension payload.");
    }

    return {
      dimensionId: assertDimensionId(value.dimensionId),
      kind: "diameter",
      label: value.label,
      entityId: assertSketchEntityId(value.entityId),
      value: value.value,
      annotationPlacement: normalizeDimensionLineAnnotationPlacement(
        value.annotationPlacement,
      ),
    };
  }

  if (value.kind === "lineLength") {
    if (!isString(value.entityId) || typeof value.value !== "number") {
      throw new Error("Invalid line length dimension payload.");
    }

    return {
      dimensionId: assertDimensionId(value.dimensionId),
      kind: "lineLength",
      label: value.label,
      entityId: assertSketchEntityId(value.entityId),
      value: value.value,
      annotationPlacement: normalizeDimensionLineAnnotationPlacement(
        value.annotationPlacement,
      ),
    };
  }

  if (value.kind === "lineDistance" || value.kind === "lineAngle") {
    if (!Array.isArray(value.lines) || value.lines.length !== 2) {
      throw new Error("Invalid line dimension payload.");
    }

    if (value.kind === "lineDistance") {
      if (typeof value.value !== "number") {
        throw new Error("Invalid line distance dimension payload.");
      }

      return {
        dimensionId: assertDimensionId(value.dimensionId),
        kind: "lineDistance",
        label: value.label,
        lines: [
          normalizeSketchCurveConstraintOperand(value.lines[0]),
          normalizeSketchCurveConstraintOperand(value.lines[1]),
        ],
        value: value.value,
        annotationPlacement: normalizeDimensionLineAnnotationPlacement(
          value.annotationPlacement,
        ),
      };
    }

    if (typeof value.valueRadians !== "number") {
      throw new Error("Invalid line angle dimension payload.");
    }

    return {
      dimensionId: assertDimensionId(value.dimensionId),
      kind: "lineAngle",
      label: value.label,
      lines: [
        normalizeSketchCurveConstraintOperand(value.lines[0]),
        normalizeSketchCurveConstraintOperand(value.lines[1]),
      ],
      valueRadians: value.valueRadians,
      annotationPlacement: normalizeDimensionAngleAnnotationPlacement(
        value.annotationPlacement,
      ),
    };
  }

  if (value.kind === "linePointDistance") {
    if (
      !isRecord(value.line) ||
      !isRecord(value.point) ||
      typeof value.value !== "number"
    ) {
      throw new Error("Invalid point-line distance dimension payload.");
    }

    return {
      dimensionId: assertDimensionId(value.dimensionId),
      kind: "linePointDistance",
      label: value.label,
      line: normalizeSketchCurveConstraintOperand(value.line),
      point: normalizeSketchPointConstraintOperand(value.point),
      value: value.value,
      annotationPlacement: normalizeDimensionLineAnnotationPlacement(
        value.annotationPlacement,
      ),
    };
  }

  if (
    value.kind === "horizontalDistance" ||
    value.kind === "verticalDistance"
  ) {
    if (
      !Array.isArray(value.pointIds) ||
      value.pointIds.length !== 2 ||
      typeof value.value !== "number"
    ) {
      throw new Error("Invalid directional distance dimension payload.");
    }

    return {
      dimensionId: assertDimensionId(value.dimensionId),
      kind: value.kind,
      label: value.label,
      pointIds: [
        assertSketchPointId(value.pointIds[0]),
        assertSketchPointId(value.pointIds[1]),
      ],
      value: value.value,
      annotationPlacement: normalizeDimensionLineAnnotationPlacement(
        value.annotationPlacement,
      ),
    };
  }

  if (
    value.kind === "arcStartPointCoincident" ||
    value.kind === "arcEndPointCoincident"
  ) {
    if (!isString(value.entityId) || !isString(value.pointId)) {
      throw new Error("Invalid arc endpoint coincidence dimension payload.");
    }

    return {
      dimensionId: assertDimensionId(value.dimensionId),
      kind: value.kind,
      label: value.label,
      entityId: assertSketchEntityId(value.entityId),
      pointId: assertSketchPointId(value.pointId),
    };
  }

  throw new Error("Invalid dimension definition kind.");
}
