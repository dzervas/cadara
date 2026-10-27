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
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import { findProjectedGeometry } from "./projected-geometry";
import type { SketchSolveTolerancePolicy } from "./solve-types";
import { makeDiagnostic } from "./solver-geometry";
export type DefinitionValidationContext = ReturnType<
  typeof createDefinitionValidationContext
>;
export function createDefinitionValidationContext(
  definition: SketchDefinition,
  tolerances: SketchSolveTolerancePolicy,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
) {
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
  return {
    definition,
    tolerances,
    projectedReferences,
    diagnostics,
    authoredStyleIds,
    authoredStyles,
    pointIds,
    entityIds,
    constraintIds,
    dimensionIds,
    referenceIds,
    styleIds,
    offsetOutputLineIds,
    pointMap,
    entityMap,
    constraintMap,
    dimensionMap,
    referenceMap,
    styleMap,
    validateDatumConstraintTarget,
    validateProjectedTarget,
    validateDatumDimensionTarget,
    validateProjectedDimensionTarget,
  };
}
