import {
  isAdvancedSketchEntity,
  splineArcEndpointTangency,
} from "./arc-geometry";
import { describeDegenerateSplineSpan } from "./degenerate-spline-recovery";
import { derivedShellRequirementDiagnostics } from "./derived-requirement-diagnostics";
import { findProjectedGeometry, unitVector } from "./projected-geometry";
import type {
  SketchCoreValidationResult,
  SketchSolveTolerancePolicy,
} from "./solve-types";
import { length, makeDiagnostic, subtract } from "./solver-geometry";
import type {
  ConstraintId,
  DimensionId,
  ReferenceId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  ProjectedSketchGeometryRef,
  NumericSketchDefinition as SketchDefinition,
  SketchSolveDiagnostic,
} from "@/contracts/sketch/schema";
import {
  orderedSplineOccurrences,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";

export function validateDefinition(
  definition: SketchDefinition,
  tolerances: SketchSolveTolerancePolicy,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
): SketchCoreValidationResult {
  const diagnostics: SketchSolveDiagnostic[] = [];
  const authoredStyleIds = definition.styleIds ?? [];
  const authoredStyles = definition.styles ?? [];
  const pointIds = new Set<SketchPointId>();
  const entityIds = new Set<SketchEntityId>();
  const constraintIds = new Set<ConstraintId>();
  const dimensionIds = new Set<DimensionId>();
  const referenceIds = new Set<ReferenceId>();
  const styleIds = new Set<(typeof authoredStyleIds)[number]>();
  const offsetOutputLineIds = new Set<SketchEntityId>(
    (definition.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "offset"
        ? relationship.outputs.map((output) => output.outputEntityId)
        : [],
    ),
  );
  const collectRecordMap = <Id extends string, Record>(
    records: readonly Record[],
    getId: (record: Record) => Id,
    duplicateCode: string,
    message: (id: Id) => string,
  ) => {
    const map = new Map<Id, Record>();
    for (const record of records) {
      const id = getId(record);
      if (map.has(id)) {
        diagnostics.push(
          makeDiagnostic(duplicateCode, "error", message(id), null),
        );
        continue;
      }
      map.set(id, record);
    }
    return map;
  };
  const pointMap = collectRecordMap(
    definition.points,
    (point) => point.pointId,
    "duplicate-point-record",
    (pointId) => `Point record ${pointId} appears more than once.`,
  );
  const entityMap = collectRecordMap(
    definition.entities,
    (entity) => entity.entityId,
    "duplicate-entity-record",
    (entityId) => `Entity record ${entityId} appears more than once.`,
  );
  const constraintMap = collectRecordMap(
    definition.constraints,
    (constraint) => constraint.constraintId,
    "duplicate-constraint-record",
    (constraintId) =>
      `Constraint record ${constraintId} appears more than once.`,
  );
  const dimensionMap = collectRecordMap(
    definition.dimensions,
    (dimension) => dimension.dimensionId,
    "duplicate-dimension-record",
    (dimensionId) => `Dimension record ${dimensionId} appears more than once.`,
  );
  const referenceMap = collectRecordMap(
    definition.references,
    (reference) => reference.referenceId,
    "duplicate-reference-record",
    (referenceId) => `Reference record ${referenceId} appears more than once.`,
  );
  const styleMap = collectRecordMap(
    authoredStyles,
    (style) => style.styleId,
    "duplicate-style-record",
    (styleId) => `Style record ${styleId} appears more than once.`,
  );
  // T17e (B2): requirements are named by label in every user text, never by id.
  const constraintName = (constraintId: ConstraintId) =>
    `‘${constraintMap.get(constraintId)?.label ?? "?"}’`;
  const dimensionName = (dimensionId: DimensionId) =>
    `‘${dimensionMap.get(dimensionId)?.label ?? "?"}’`;
  const projectedTargetExists = (
    reference: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    },
  ) => findProjectedGeometry(projectedReferences, reference) !== null;
  const validateDatumConstraintTarget = (
    constraintId: ConstraintId,
    datum: "origin" | "xAxis" | "yAxis",
    expectedKinds: readonly ("origin" | "axis")[],
  ) => {
    const actualKind = datum === "origin" ? "origin" : "axis";
    if (!expectedKinds.includes(actualKind)) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-datum-constraint-target-kind",
          "error",
          `${constraintName(constraintId)} targets datum ${datum}, which is not valid for this relationship.`,
          { kind: "constraint", constraintId },
        ),
      );
    }
  };
  const validateProjectedTarget = (
    constraintId: ConstraintId,
    reference: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    },
    expectedKinds: readonly NonNullable<ProjectedSketchGeometryRef["kind"]>[],
  ) => {
    if (!referenceIds.has(reference.referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "missing-projected-constraint-reference",
          "error",
          `${constraintName(constraintId)} targets a reference that no longer exists.`,
          { kind: "constraint", constraintId },
        ),
      );
      return;
    }

    if (!expectedKinds.includes(reference.kind)) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-projected-constraint-target-kind",
          "error",
          `${constraintName(constraintId)} targets ${reference.kind}, which is not valid for this relationship.`,
          { kind: "constraint", constraintId },
        ),
      );
      return;
    }

    if (!projectedTargetExists(reference)) {
      diagnostics.push(
        makeDiagnostic(
          "missing-projected-constraint-target",
          "error",
          `${constraintName(constraintId)} targets projected geometry that is not available.`,
          { kind: "constraint", constraintId },
        ),
      );
    }
  };
  const validateDatumDimensionTarget = (
    dimensionId: DimensionId,
    datum: "origin" | "xAxis" | "yAxis",
    expectedKinds: readonly ("origin" | "axis")[],
  ) => {
    const actualKind = datum === "origin" ? "origin" : "axis";
    if (!expectedKinds.includes(actualKind)) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-datum-dimension-target-kind",
          "error",
          `${dimensionName(dimensionId)} targets datum ${datum}, which is not valid for this dimension.`,
          { kind: "dimension", dimensionId },
        ),
      );
    }
  };
  const validateProjectedDimensionTarget = (
    dimensionId: DimensionId,
    reference: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    },
    expectedKinds: readonly NonNullable<ProjectedSketchGeometryRef["kind"]>[],
  ) => {
    if (!referenceIds.has(reference.referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "missing-projected-dimension-reference",
          "error",
          `${dimensionName(dimensionId)} targets a reference that no longer exists.`,
          { kind: "dimension", dimensionId },
        ),
      );
      return;
    }

    if (!expectedKinds.includes(reference.kind)) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-projected-dimension-target-kind",
          "error",
          `${dimensionName(dimensionId)} targets ${reference.kind}, which is not valid for this dimension.`,
          { kind: "dimension", dimensionId },
        ),
      );
      return;
    }

    if (!projectedTargetExists(reference)) {
      diagnostics.push(
        makeDiagnostic(
          "missing-projected-dimension-target",
          "error",
          `${dimensionName(dimensionId)} targets projected geometry that is not available.`,
          { kind: "dimension", dimensionId },
        ),
      );
    }
  };

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
              !Number.isFinite(
                length(subtract(start.position, end.position)),
              )
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
          !a || !b || a.kind !== b.kind ||
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
            projectedReferences, constraint.projectedLine.reference,
          );
          if (
            projected?.kind === "lineSegment" &&
            !unitVector(projected.startPosition, projected.endPosition)
          ) {
            diagnostics.push(makeDiagnostic(
              "unsupported-constraint-operands", "error",
              `‘${constraint.label}’ has an unsupported operand combination: a projected line must have a nonzero direction.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ));
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
        if (
          entities.some((entity) => entity && isAdvancedSketchEntity(entity))
        ) {
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
          diagnostics.push(makeDiagnostic(
            "unsupported-constraint-operands",
            "error",
            `‘${constraint.label}’ has an unsupported operand combination: Tangent needs a circle or arc.`,
            { kind: "constraint", constraintId: constraint.constraintId },
          ));
        }
        break;
      }
      case "concentric": {
        const entities = constraint.entityIds.map((entityId) =>
          entityMap.get(entityId),
        );
        if (
          entities.some((entity) => entity && isAdvancedSketchEntity(entity))
        ) {
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
    if (!dimensionIds.has(dimension.dimensionId)) {
      diagnostics.push(
        makeDiagnostic(
          "dimension-missing-from-order",
          "error",
          `Dimension ${dimension.dimensionId} is not listed in dimensionIds.`,
          { kind: "dimension", dimensionId: dimension.dimensionId },
        ),
      );
    }

    switch (dimension.kind) {
      case "distance":
      case "horizontalDistance":
      case "verticalDistance":
        if (!dimension.pointIds.every((pointId) => pointMap.has(pointId))) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-point",
              "error",
              `‘${dimension.label}’ references a point that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
      case "pointDatumDistance":
        if (!pointMap.has(dimension.point.pointId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-point",
              "error",
              `‘${dimension.label}’ references a point that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        validateDatumDimensionTarget(
          dimension.dimensionId,
          dimension.datum.datum,
          ["origin"],
        );
        break;
      case "circleRadius":
        if (!entityMap.has(dimension.entityId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-entity",
              "error",
              `‘${dimension.label}’ references geometry that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
      case "diameter": {
        const entity = entityMap.get(dimension.entityId);
        if (!entity || (entity.kind !== "circle" && entity.kind !== "arc")) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-entity",
              "error",
              `‘${dimension.label}’ references a circle or arc that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
      }
      case "lineLength": {
        const entity = entityMap.get(dimension.entityId);
        if (!entity || entity.kind !== "lineSegment") {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-entity",
              "error",
              `‘${dimension.label}’ references a line that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
      }
      case "lineDistance":
      case "lineAngle":
        for (const line of dimension.lines) {
          if (line.kind === "localEntity") {
            const entity = entityMap.get(line.entityId);
            if (!entity || entity.kind !== "lineSegment") {
              diagnostics.push(
                makeDiagnostic(
                  "missing-dimension-entity",
                  "error",
                  `‘${dimension.label}’ references a line that no longer exists.`,
                  { kind: "dimension", dimensionId: dimension.dimensionId },
                ),
              );
            }
          } else if (line.kind === "sketchDatum") {
            validateDatumDimensionTarget(dimension.dimensionId, line.datum, [
              "axis",
            ]);
          } else {
            validateProjectedDimensionTarget(
              dimension.dimensionId,
              line.reference,
              ["projectedLineSegment"],
            );
          }
        }
        break;
      case "linePointDistance":
        if (dimension.line.kind === "localEntity") {
          const entity = entityMap.get(dimension.line.entityId);
          if (!entity || entity.kind !== "lineSegment") {
            diagnostics.push(
              makeDiagnostic(
                "missing-dimension-entity",
                "error",
                `‘${dimension.label}’ references a line that no longer exists.`,
                { kind: "dimension", dimensionId: dimension.dimensionId },
              ),
            );
          }
        } else if (dimension.line.kind === "sketchDatum") {
          validateDatumDimensionTarget(
            dimension.dimensionId,
            dimension.line.datum,
            ["axis"],
          );
        } else {
          validateProjectedDimensionTarget(
            dimension.dimensionId,
            dimension.line.reference,
            ["projectedLineSegment"],
          );
        }
        if (dimension.point.kind === "localPoint") {
          if (!pointMap.has(dimension.point.pointId)) {
            diagnostics.push(
              makeDiagnostic(
                "missing-dimension-point",
                "error",
                `‘${dimension.label}’ references a point that no longer exists.`,
                { kind: "dimension", dimensionId: dimension.dimensionId },
              ),
            );
          }
        } else if (dimension.point.kind === "sketchDatum") {
          validateDatumDimensionTarget(
            dimension.dimensionId,
            dimension.point.datum,
            ["origin"],
          );
        } else {
          validateProjectedDimensionTarget(
            dimension.dimensionId,
            dimension.point.reference,
            ["projectedPoint"],
          );
        }
        break;
      case "arcStartPointCoincident":
      case "arcEndPointCoincident":
        if (
          !entityMap.has(dimension.entityId) ||
          !pointMap.has(dimension.pointId)
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-arc-endpoint-reference",
              "error",
              `‘${dimension.label}’ references an arc or point that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
    }
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
