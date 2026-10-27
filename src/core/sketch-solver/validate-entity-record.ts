import type { SketchPointId } from "@/contracts/shared/ids";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import {
  orderedSplineOccurrences,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";
import type { DefinitionValidationContext } from "./definition-validation-context";
import { describeDegenerateSplineSpan } from "./degenerate-spline-recovery";
import { length, makeDiagnostic, subtract } from "./solver-geometry";
export function validateEntityRecord(
  context: DefinitionValidationContext,
  entity: SketchDefinition["entities"][number],
): void {
  const { tolerances, diagnostics, entityIds, offsetOutputLineIds, pointMap } =
    context;

  if (!entityIds.has(entity.entityId)) {
    diagnostics.push(
      makeDiagnostic(
        "entity-missing-from-order",
        "error",
        `Entity ${entity.entityId} is not listed in entityIds.`,
        { kind: "entity", entityId: entity.entityId },
      ),
    );
  }

  if (entity.kind === "lineSegment") {
    const start = pointMap.get(entity.startPointId);
    const end = pointMap.get(entity.endPointId);
    if (!start || !end) {
      diagnostics.push(
        makeDiagnostic(
          "missing-line-endpoint",
          "error",
          `‘${entity.label}’ references an endpoint that no longer exists.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    } else if (
      // T10i (C5, [TECH] T-11): an offset relationship's line output is
      // relationship-owned; its solve frame fails it below τ
      // (`derived-offset-output-degenerate`, [TECH] G16′).
      !offsetOutputLineIds.has(entity.entityId) &&
      length(subtract(start.position, end.position)) <
        tolerances.minimumSegmentLength
    ) {
      diagnostics.push(
        makeDiagnostic(
          "degenerate-line-segment",
          "error",
          `‘${entity.label}’ is shorter than the minimum segment length tolerance.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }
  }

  if (entity.kind === "circle" && entity.radius <= 0) {
    diagnostics.push(
      makeDiagnostic(
        "invalid-circle-radius",
        "error",
        `‘${entity.label}’ must have a radius greater than zero.`,
        { kind: "entity", entityId: entity.entityId },
      ),
    );
  }

  if (entity.kind === "spline") {
    const occurrences = orderedSplineOccurrences(entity);
    if (!occurrences || occurrences.length < 2) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-spline-point-occurrences",
          "error",
          `‘${entity.label}’ requires at least two ordered point occurrences.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    } else if (occurrences.some(({ pointId }) => !pointMap.has(pointId))) {
      diagnostics.push(
        makeDiagnostic(
          "missing-spline-fit-point",
          "error",
          `‘${entity.label}’ references a fit point that no longer exists.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    } else {
      const reconstruction = reconstructSplineAggregate(
        entity,
        Object.fromEntries(
          [...pointMap.entries()].map(([pointId, point]) => [
            pointId,
            point.position,
          ]),
        ),
      );
      for (const diagnostic of reconstruction.diagnostics) {
        diagnostics.push(
          makeDiagnostic(
            `invalid-spline-${diagnostic.code}`,
            "error",
            diagnostic.code === "coincident-points" &&
              diagnostic.spanIndex !== undefined
              ? describeDegenerateSplineSpan(
                  entity,
                  diagnostic.spanIndex,
                  (pointId) => pointMap.get(pointId as SketchPointId)?.label,
                )
              : `‘${entity.label}’ reconstruction is invalid: ${diagnostic.code}.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
    }
  }

  if (entity.kind === "ellipse") {
    const center = pointMap.get(entity.centerPointId);
    const major = pointMap.get(entity.majorAxisPointId);
    if (!center || !major) {
      diagnostics.push(
        makeDiagnostic(
          "missing-ellipse-defining-point",
          "error",
          `‘${entity.label}’ references a defining point that no longer exists.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    } else if (
      length(subtract(center.position, major.position)) <
      tolerances.minimumSegmentLength
    ) {
      diagnostics.push(
        makeDiagnostic(
          "degenerate-ellipse-major-axis",
          "error",
          `‘${entity.label}’ major radius is shorter than the minimum segment length tolerance.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }
    if (entity.minorRadius <= 0) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-ellipse-minor-radius",
          "error",
          `‘${entity.label}’ minor radius must be greater than zero.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }
  }

  if (entity.kind === "ellipticalArc") {
    const center = pointMap.get(entity.centerPointId);
    const major = pointMap.get(entity.majorAxisPointId);
    const start = pointMap.get(entity.startPointId);
    const end = pointMap.get(entity.endPointId);
    if (!center || !major || !start || !end) {
      diagnostics.push(
        makeDiagnostic(
          "missing-elliptical-arc-defining-point",
          "error",
          `‘${entity.label}’ references a defining point that no longer exists.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    } else {
      if (
        length(subtract(center.position, major.position)) <
        tolerances.minimumSegmentLength
      ) {
        diagnostics.push(
          makeDiagnostic(
            "degenerate-elliptical-arc-major-axis",
            "error",
            `‘${entity.label}’ major radius is shorter than the minimum segment length tolerance.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
      if (
        length(subtract(start.position, end.position)) <
        tolerances.minimumSegmentLength
      ) {
        diagnostics.push(
          makeDiagnostic(
            "degenerate-elliptical-arc-endpoints",
            "error",
            `‘${entity.label}’ start and end points are coincident.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
    }
    if (entity.minorRadius <= 0) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-elliptical-arc-minor-radius",
          "error",
          `‘${entity.label}’ minor radius must be greater than zero.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }
  }

  if (entity.kind === "conic") {
    const pointIds = [
      entity.startPointId,
      entity.controlPointId,
      entity.endPointId,
    ];
    const uniquePointIds = new Set(pointIds);
    if (uniquePointIds.size !== pointIds.length) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-conic-defining-points",
          "error",
          `‘${entity.label}’ requires three distinct defining points.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    } else if (pointIds.some((pointId) => !pointMap.has(pointId))) {
      diagnostics.push(
        makeDiagnostic(
          "missing-conic-defining-point",
          "error",
          `‘${entity.label}’ references a defining point that no longer exists.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }
    if (entity.rho <= 0) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-conic-rho",
          "error",
          `‘${entity.label}’ rho must be greater than zero.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }
  }

  if (entity.kind === "bezierCurve") {
    const expectedPointCount = entity.degree + 1;
    const uniquePointIds = new Set(entity.controlPointIds);
    if (
      entity.controlPointIds.length !== expectedPointCount ||
      uniquePointIds.size !== entity.controlPointIds.length
    ) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-bezier-control-points",
          "error",
          `‘${entity.label}’ requires ${expectedPointCount} distinct control points.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    } else if (
      entity.controlPointIds.some((pointId) => !pointMap.has(pointId))
    ) {
      diagnostics.push(
        makeDiagnostic(
          "missing-bezier-control-point",
          "error",
          `‘${entity.label}’ references a control point that no longer exists.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }
  }

  if (entity.kind === "profileText") {
    if (!pointMap.has(entity.anchorPointId)) {
      diagnostics.push(
        makeDiagnostic(
          "missing-profile-text-anchor",
          "error",
          `‘${entity.label}’ references an anchor point that no longer exists.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }
    if (entity.text.trim().length === 0) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-profile-text-content",
          "error",
          `‘${entity.label}’ must contain text.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }
    if (entity.height <= 0) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-profile-text-height",
          "error",
          `‘${entity.label}’ height must be greater than zero.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }
  }
}
