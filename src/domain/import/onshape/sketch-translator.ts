/**
 * Sketch translator (2.3).
 *
 * Translates an Onshape solved sketch into a cadara `CommitSketchRequest`
 * definition on a canonical datum plane, seeding point geometry from Onshape's
 * solved positions so under-constrained sketches do not drift on import.
 * Supported entity kinds (line/circle/arc/point) translate table-driven;
 * supported local constraints, dimensions, and derivations are carried when
 * their operands resolve against the translated sketch graph. Unsupported or
 * external records degrade per-record with structured diagnostics.
 */
import {
  createExpressionAuthoredValue,
  createLiteralAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type {
  ConstraintId,
  DimensionId,
  DocumentId,
  SketchEntityId,
  RequestId,
  RevisionId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { ContractVersion } from "@/contracts/shared/versioning";
import type { SketchPlaneKey } from "@/contracts/shared/sketch-plane";
import type {
  SketchPlaneDefinition,
  SketchPlaneFrame,
} from "@/contracts/shared/sketch-plane";
import {
  SKETCH_SCHEMA_VERSION,
  type ConstraintDefinition,
  type DimensionDefinition,
  type LocalSketchEntityConstraintOperand,
  type LocalSketchPointConstraintOperand,
  type SketchDefinition,
  type SketchDerivationDefinition,
  type SketchDimensionAuthoredValue,
  type SketchEntityDefinition,
  type SketchPoint2D,
  type SketchPointDefinition,
} from "@/contracts/sketch/schema";

import { translateOnshapeExpression } from "@/domain/import/onshape/expression-translator";
import type { SketchSolverAdapter } from "@/contracts/solver/adapter";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import type { OnshapeSketchConstraint } from "@/domain/import/onshape/bundle-reader";

export type SolvedSketchEntityKind =
  | "lineSegment"
  | "circle"
  | "arc"
  | "point";

export interface SolvedSketchEntityGeometry {
  entityId: string;
  entityType: string;
  isConstruction?: boolean;
  start?: SketchPoint2D;
  end?: SketchPoint2D;
  center?: SketchPoint2D;
  radius?: number;
  position?: SketchPoint2D;
  sweepDirection?: "clockwise" | "counterClockwise";
}

export interface SketchTranslationInput {
  featureId: string;
  label: string;
  planeKey?: SketchPlaneKey;
  plane?: SketchPlaneDefinition;
  entities: readonly SolvedSketchEntityGeometry[];
  constraints?: readonly OnshapeSketchConstraint[];
  sourceSolveStatus?: string;
}

export interface SketchRelationshipSummary {
  constraints: { carried: number; dropped: number };
  dimensions: { carried: number; dropped: number };
  derivations: { carried: number; dropped: number };
}

export interface SketchTranslationDiagnostic {
  code:
    | "onshape-sketch-unsupported-entity"
    | "onshape-sketch-degenerate-entity"
    | "onshape-sketch-relationship-dropped"
    | "onshape-sketch-external-reference-dropped"
    | "onshape-sketch-expression-degraded"
    | "onshape-sketch-solve-consistency-failed"
    | "onshape-sketch-residual-mobility"
    | "onshape-sketch-residual-mobility-grounded";
  message: string;
  entityId?: string;
  entityType?: string;
  relationshipKind?: string;
  operands?: readonly string[];
  reason?: string;
}

export interface SketchTranslationResult {
  plane: SketchPlaneDefinition;
  definition: SketchDefinition;
  diagnostics: SketchTranslationDiagnostic[];
  relationshipSummary: SketchRelationshipSummary;
  sourceSolveStatus?: string;
}

function normalizeCoincidentPointTopology(definition: SketchDefinition) {
  const parentByPointId = new Map<SketchPointId, SketchPointId>(
    definition.pointIds.map((pointId) => [pointId, pointId]),
  );

  const findRoot = (pointId: SketchPointId): SketchPointId => {
    const parent = parentByPointId.get(pointId);
    if (!parent || parent === pointId) return pointId;
    const root = findRoot(parent);
    parentByPointId.set(pointId, root);
    return root;
  };
  const pointOrder = new Map(
    definition.pointIds.map((pointId, index) => [pointId, index]),
  );

  for (const constraint of definition.constraints) {
    if (constraint.kind !== "coincident") continue;
    const left = findRoot(constraint.pointIds[0]);
    const right = findRoot(constraint.pointIds[1]);
    if (left === right) continue;
    const leftOrder = pointOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = pointOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
    parentByPointId.set(
      leftOrder <= rightOrder ? right : left,
      leftOrder <= rightOrder ? left : right,
    );
  }

  const replacements = new Map<SketchPointId, SketchPointId>();
  for (const pointId of definition.pointIds) {
    const root = findRoot(pointId);
    if (root !== pointId) replacements.set(pointId, root);
  }
  if (replacements.size === 0) return definition;

  const replacePointIds = (value: unknown): unknown => {
    if (typeof value === "string") {
      return replacements.get(value as SketchPointId) ?? value;
    }
    if (Array.isArray(value)) return value.map(replacePointIds);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, replacePointIds(entry)]),
      );
    }
    return value;
  };

  const normalized = replacePointIds(
    structuredClone(definition),
  ) as SketchDefinition;
  normalized.points = normalized.points.filter(
    (point, index, all) =>
      all.findIndex((candidate) => candidate.pointId === point.pointId) === index,
  );
  normalized.pointIds = normalized.points.map((point) => point.pointId);
  return normalized;
}

export interface SketchSolveConsistencyInput {
  solver: SketchSolverAdapter;
  contractVersion: ContractVersion;
  documentId: DocumentId;
  revisionId: RevisionId;
  sketchId: SketchId;
  plane: SketchPlaneDefinition;
  definition: SketchDefinition;
  relationshipSummary: SketchRelationshipSummary;
  sourceSolveStatus?: string;
  tolerance?: number;
}

export interface SketchSolveConsistencyResult {
  definition: SketchDefinition;
  diagnostics: SketchTranslationDiagnostic[];
  relationshipSummary: SketchRelationshipSummary;
}

interface CanonicalPlaneSpec {
  constructionId: `construction_plane-${SketchPlaneKey}`;
  frame: SketchPlaneFrame;
}

interface TranslationMaps {
  entitiesByRawId: Map<string, SketchEntityDefinition>;
  pointsByRawOperand: Map<string, SketchPointId>;
}

type ParsedOperand =
  | { kind: "point"; raw: string; pointId: SketchPointId }
  | { kind: "entity"; raw: string; entityId: SketchEntityId }
  | { kind: "external"; raw: string }
  | { kind: "missing"; raw: string };

const CANONICAL_PLANE_SPECS: Record<SketchPlaneKey, CanonicalPlaneSpec> = {
  xy: {
    constructionId: "construction_plane-xy",
    frame: {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
      linearUnit: "documentLength",
      handedness: "rightHanded",
    },
  },
  yz: {
    constructionId: "construction_plane-yz",
    frame: {
      origin: [0, 0, 0],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      normal: [1, 0, 0],
      linearUnit: "documentLength",
      handedness: "rightHanded",
    },
  },
  xz: {
    constructionId: "construction_plane-xz",
    frame: {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 0, 1],
      normal: [0, -1, 0],
      linearUnit: "documentLength",
      handedness: "rightHanded",
    },
  },
};

const METERS_TO_MM = 1000;
const POINT_SUFFIXES = ["start", "end", "center", "middle", "point"] as const;
const DIMENSION_KINDS = new Set(["DISTANCE", "LENGTH", "DIAMETER", "ANGLE", "RADIUS"]);
const DERIVATION_KINDS = new Set(["MIRROR", "LINEAR_PATTERN", "OFFSET"]);
const LINEAR_PATTERN_VECTOR_TOLERANCE = 1e-4;

function dot3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Project a world-space point (meters) onto a sketch frame, returning 2D
 * sketch-plane coordinates in document millimeters.
 */
export function projectPointToSketchPlaneFrame(
  point3d: readonly [number, number, number],
  frame: SketchPlaneFrame,
): SketchPoint2D {
  const pointMm: readonly [number, number, number] = [
    point3d[0] * METERS_TO_MM,
    point3d[1] * METERS_TO_MM,
    point3d[2] * METERS_TO_MM,
  ];
  const delta: readonly [number, number, number] = [
    pointMm[0] - frame.origin[0],
    pointMm[1] - frame.origin[1],
    pointMm[2] - frame.origin[2],
  ];
  return [dot3(delta, frame.xAxis), dot3(delta, frame.yAxis)];
}

/** Project a world-space point (meters) onto a complete sketch plane definition. */
export function projectPointToSketchPlane(
  point3d: readonly [number, number, number],
  plane: SketchPlaneDefinition,
): SketchPoint2D {
  return projectPointToSketchPlaneFrame(point3d, plane.frame);
}

/** Project a world-space point (meters) onto a canonical datum plane. */
export function projectPointToPlane(
  point3d: readonly [number, number, number],
  planeKey: SketchPlaneKey,
): SketchPoint2D {
  return projectPointToSketchPlane(point3d, planeDefinition(planeKey));
}

function planeDefinition(planeKey: SketchPlaneKey): SketchPlaneDefinition {
  const spec = CANONICAL_PLANE_SPECS[planeKey];
  return {
    support: { kind: "construction", constructionId: spec.constructionId },
    frame: spec.frame,
    key: planeKey,
  };
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_");
}

function pointId(featureId: string, suffix: string): SketchPointId {
  return `sketch_point_${sanitizeId(featureId)}_${suffix}` as SketchPointId;
}

function entityId(featureId: string, raw: string): SketchEntityId {
  return `sketch_entity_${sanitizeId(featureId)}_${sanitizeId(raw)}` as SketchEntityId;
}

/** Stable authored entity id used by imported Onshape sketches. */
export function importedOnshapeSketchEntityId(featureId: string, raw: string): SketchEntityId {
  return entityId(featureId, raw);
}

function constraintId(featureId: string, raw: string): ConstraintId {
  return `constraint_${sanitizeId(featureId)}_${sanitizeId(raw)}` as ConstraintId;
}

function dimensionId(featureId: string, raw: string): DimensionId {
  return `dimension_${sanitizeId(featureId)}_${sanitizeId(raw)}` as DimensionId;
}

function derivationId(featureId: string, raw: string): string {
  return `derivation_${sanitizeId(featureId)}_${sanitizeId(raw)}`;
}

function parameter(
  record: OnshapeSketchConstraint,
  parameterId: string,
): NonNullable<OnshapeSketchConstraint["parameters"]>[number] | undefined {
  return record.parameters.find((entry) => entry.parameterId === parameterId);
}

function stringParameter(record: OnshapeSketchConstraint, parameterId: string): string | null {
  const value = parameter(record, parameterId)?.value;
  return typeof value === "string" ? value : null;
}

function firstStringParameter(
  record: OnshapeSketchConstraint,
  parameterIds: readonly string[],
): string | null {
  for (const parameterId of parameterIds) {
    const value = stringParameter(record, parameterId);
    if (value !== null) {
      return value;
    }
  }
  return null;
}


function quantityExpression(record: OnshapeSketchConstraint, parameterId: string): string | null {
  const value = parameter(record, parameterId);
  if (!value) {
    return null;
  }
  if (typeof value.expression === "string") {
    return value.expression;
  }
  return typeof value.value === "number" ? String(value.value) : null;
}

function hasExternalOperand(record: OnshapeSketchConstraint): boolean {
  return record.parameters.some(
    (entry) => entry.parameterId.toLowerCase().startsWith("external") && entry.hasExternalQuery,
  );
}

function rawOperands(record: OnshapeSketchConstraint): string[] {
  return record.parameters
    .filter((entry) => {
      const id = entry.parameterId.toLowerCase();
      return id.startsWith("local") || id.startsWith("external");
    })
    .map((entry) => entry.value)
    .filter((value): value is string => typeof value === "string");
}

function parseOperand(raw: string | null, maps: TranslationMaps): ParsedOperand {
  if (!raw) {
    return { kind: "missing", raw: "" };
  }
  const directPoint = maps.pointsByRawOperand.get(raw);
  if (directPoint) {
    return { kind: "point", raw, pointId: directPoint };
  }
  const directEntity = maps.entitiesByRawId.get(raw);
  if (directEntity) {
    return { kind: "entity", raw, entityId: directEntity.entityId };
  }
  for (const suffix of POINT_SUFFIXES) {
    const marker = `.${suffix}`;
    if (!raw.endsWith(marker)) {
      continue;
    }
    const base = raw.slice(0, -marker.length);
    const point = maps.pointsByRawOperand.get(`${base}.${suffix}`);
    if (point) {
      return { kind: "point", raw, pointId: point };
    }
  }
  return { kind: "missing", raw };
}

function pointOperand(value: ParsedOperand): LocalSketchPointConstraintOperand | null {
  return value.kind === "point" ? { kind: "localPoint", pointId: value.pointId } : null;
}

function entityOperand(value: ParsedOperand): LocalSketchEntityConstraintOperand | null {
  return value.kind === "entity" ? { kind: "localEntity", entityId: value.entityId } : null;
}

function dropRelationship(
  diagnostics: SketchTranslationDiagnostic[],
  record: OnshapeSketchConstraint,
  reason: string,
  operands = rawOperands(record),
): void {
  diagnostics.push({
    code: hasExternalOperand(record)
      ? "onshape-sketch-external-reference-dropped"
      : "onshape-sketch-relationship-dropped",
    message: `Sketch relationship "${record.entityId}" (${record.constraintType}) was dropped: ${reason}.`,
    relationshipKind: record.constraintType,
    operands,
    reason,
  });
}

function translateDimensionValue(
  diagnostics: SketchTranslationDiagnostic[],
  record: OnshapeSketchConstraint,
  parameterId = "length",
): SketchDimensionAuthoredValue {
  const expression = quantityExpression(record, parameterId);
  const translated = translateOnshapeExpression({ expression });
  if (translated.diagnostic) {
    diagnostics.push({
      code: "onshape-sketch-expression-degraded",
      message: translated.diagnostic.message,
      relationshipKind: record.constraintType,
      operands: rawOperands(record),
      reason: translated.diagnostic.code,
    });
  }
  return createExpressionAuthoredValue(translated.valueText);
}

function translateAngleValue(
  diagnostics: SketchTranslationDiagnostic[],
  record: OnshapeSketchConstraint,
): SketchDimensionAuthoredValue {
  const value = translateDimensionValue(diagnostics, record, "angle");
  if (typeof value === "object" && value?.source === "expression") {
    const numeric = Number(value.valueText);
    return Number.isFinite(numeric)
      ? createExpressionAuthoredValue(String(numeric * (Math.PI / 180)))
      : createExpressionAuthoredValue(`(${value.valueText}) * ${Math.PI / 180}`);
  }
  return value;
}

function entityPointIds(
  entity: SketchEntityDefinition | undefined,
): readonly SketchPointId[] {
  if (!entity) {
    return [];
  }
  switch (entity.kind) {
    case "lineSegment":
      return [entity.startPointId, entity.endPointId];
    case "circle":
      return [entity.centerPointId];
    case "arc":
      return [entity.centerPointId, entity.startPointId, entity.endPointId];
    case "point":
      return [entity.pointId];
    default:
      return [];
  }
}

function translateConstraintRecord(input: {
  featureId: string;
  record: OnshapeSketchConstraint;
  maps: TranslationMaps;
  diagnostics: SketchTranslationDiagnostic[];
}): ConstraintDefinition | null {
  const { featureId, record, maps, diagnostics } = input;
  const label = record.entityId;
  const id = constraintId(featureId, record.entityId);
  const first = parseOperand(
    firstStringParameter(record, [
      "localFirst",
      "localEntity1",
      "externalFirst",
      "externalEntity1",
    ]),
    maps,
  );
  const second = parseOperand(
    firstStringParameter(record, [
      "localSecond",
      "localEntity2",
      "externalSecond",
      "externalEntity2",
    ]),
    maps,
  );

  switch (record.constraintType) {
    case "COINCIDENT": {
      if (first.kind === "point" && second.kind === "point") {
        return { constraintId: id, kind: "coincident", label, pointIds: [first.pointId, second.pointId] };
      }
      break;
    }
    case "MIDPOINT": {
      const midpoint = parseOperand(
        firstStringParameter(record, [
          "localMidpoint",
          "localEntity1",
          "externalMidpoint",
          "externalEntity1",
        ]),
        maps,
      );
      const line = parseOperand(
        firstStringParameter(record, [
          "localEntity2",
          "localSecond",
          "externalEntity2",
          "externalSecond",
        ]),
        maps,
      );
      const point = pointOperand(midpoint);
      const lineEntity = entityOperand(line);
      if (point && lineEntity) {
        return { constraintId: id, kind: "midpoint", label, point, line: lineEntity };
      }
      break;
    }
    case "HORIZONTAL": {
      if (first.kind === "entity") {
        return { constraintId: id, kind: "horizontal", label, entityId: first.entityId };
      }
      break;
    }
    case "VERTICAL": {
      if (first.kind === "entity") {
        return { constraintId: id, kind: "vertical", label, entityId: first.entityId };
      }
      break;
    }
    case "PARALLEL": {
      if (first.kind === "entity" && second.kind === "entity") {
        return { constraintId: id, kind: "parallel", label, entityIds: [first.entityId, second.entityId] };
      }
      break;
    }
    case "PERPENDICULAR": {
      if (first.kind === "entity" && second.kind === "entity") {
        return { constraintId: id, kind: "perpendicular", label, entityIds: [first.entityId, second.entityId] };
      }
      break;
    }
    case "EQUAL": {
      if (first.kind === "entity" && second.kind === "entity") {
        return { constraintId: id, kind: "equalLength", label, entityIds: [first.entityId, second.entityId] };
      }
      break;
    }
    case "TANGENT": {
      if (first.kind === "entity" && second.kind === "entity") {
        return { constraintId: id, kind: "tangent", label, entityIds: [first.entityId, second.entityId], relation: "external" };
      }
      break;
    }
    case "CONCENTRIC": {
      if (first.kind === "entity" && second.kind === "entity") {
        return { constraintId: id, kind: "concentric", label, entityIds: [first.entityId, second.entityId] };
      }
      break;
    }
    default:
      dropRelationship(diagnostics, record, "unsupported constraint kind");
      return null;
  }

  dropRelationship(diagnostics, record, "local operands did not match the required cadara target types");
  return null;
}

function translateDimensionRecord(input: {
  featureId: string;
  record: OnshapeSketchConstraint;
  maps: TranslationMaps;
  diagnostics: SketchTranslationDiagnostic[];
}): DimensionDefinition | null {
  const { featureId, record, maps, diagnostics } = input;
  const id = dimensionId(featureId, record.entityId);
  const label = record.entityId;
  const first = parseOperand(
    firstStringParameter(record, ["localFirst", "localEntity1", "externalFirst", "externalEntity1"]),
    maps,
  );
  const second = parseOperand(
    firstStringParameter(record, ["localSecond", "localEntity2", "externalSecond", "externalEntity2"]),
    maps,
  );
  const value = translateDimensionValue(diagnostics, record);

  switch (record.constraintType) {
    case "DISTANCE": {
      const direction = stringParameter(record, "direction");
      if (first.kind === "point" && second.kind === "point") {
        if (direction === "HORIZONTAL") {
          return { dimensionId: id, kind: "horizontalDistance", label, pointIds: [first.pointId, second.pointId], value };
        }
        if (direction === "VERTICAL") {
          return { dimensionId: id, kind: "verticalDistance", label, pointIds: [first.pointId, second.pointId], value };
        }
        return { dimensionId: id, kind: "distance", label, axis: "aligned", pointIds: [first.pointId, second.pointId], value };
      }
      if (first.kind === "entity" && second.kind === "entity") {
        // `lineDistance` is line-to-line only; the solver rejects any other
        // entity kind outright, which would fail the whole sketch. Onshape also
        // uses DISTANCE between circles/arcs (a radial gap), which has no
        // equivalent Cadara dimension: drop that relationship honestly rather
        // than emit a dimension the solver cannot build.
        const firstEntity = maps.entitiesByRawId.get(first.raw);
        const secondEntity = maps.entitiesByRawId.get(second.raw);
        if (
          firstEntity?.kind === "lineSegment" &&
          secondEntity?.kind === "lineSegment"
        ) {
          return {
            dimensionId: id,
            kind: "lineDistance",
            label,
            lines: [
              { kind: "localEntity", entityId: first.entityId },
              { kind: "localEntity", entityId: second.entityId },
            ],
            value,
          };
        }
        dropRelationship(
          diagnostics,
          record,
          "entity-to-entity distance is supported only between two line segments",
        );
        return null;
      }
      // `linePointDistance` also accepts only a line segment. Onshape's
      // point-to-circle/arc distance (a radial gap) has no Cadara equivalent;
      // dropping it honestly keeps the rest of the sketch solvable.
      const lineOperand =
        first.kind === "entity" ? first : second.kind === "entity" ? second : null;
      const pointOperandValue =
        first.kind === "point" ? first : second.kind === "point" ? second : null;
      if (lineOperand && pointOperandValue) {
        if (maps.entitiesByRawId.get(lineOperand.raw)?.kind !== "lineSegment") {
          dropRelationship(
            diagnostics,
            record,
            "point-to-entity distance is supported only against a line segment",
          );
          return null;
        }
        return {
          dimensionId: id,
          kind: "linePointDistance",
          label,
          line: { kind: "localEntity", entityId: lineOperand.entityId },
          point: { kind: "localPoint", pointId: pointOperandValue.pointId },
          value,
        };
      }
      break;
    }
    case "LENGTH": {
      if (first.kind === "entity") {
        return { dimensionId: id, kind: "lineLength", label, entityId: first.entityId, value };
      }
      break;
    }
    case "DIAMETER": {
      if (first.kind === "entity") {
        return { dimensionId: id, kind: "diameter", label, entityId: first.entityId, value };
      }
      break;
    }
    case "RADIUS": {
      if (first.kind === "entity") {
        return { dimensionId: id, kind: "circleRadius", label, entityId: first.entityId, value };
      }
      break;
    }
    case "ANGLE": {
      if (first.kind === "entity" && second.kind === "entity") {
        return {
          dimensionId: id,
          kind: "lineAngle",
          label,
          lines: [
            { kind: "localEntity", entityId: first.entityId },
            { kind: "localEntity", entityId: second.entityId },
          ],
          valueRadians: translateAngleValue(diagnostics, record),
        };
      }
      break;
    }
  }

  dropRelationship(diagnostics, record, "dimension operands did not match a supported cadara dimension shape");
  return null;
}

function makeOutput(
  seed: SketchEntityDefinition,
  output: SketchEntityDefinition,
  instanceIndex: number,
) {
  return {
    seedEntityId: seed.entityId,
    outputEntityId: output.entityId,
    instanceIndex,
    seedPointIds: entityPointIds(seed),
    outputPointIds: entityPointIds(output),
  };
}

function entityPatternDisplacement(input: {
  seed: SketchEntityDefinition;
  output: SketchEntityDefinition;
  pointsById: ReadonlyMap<SketchPointId, SketchPointDefinition>;
}): SketchPoint2D | null {
  const { seed, output, pointsById } = input;
  if (seed.kind !== output.kind) {
    return null;
  }
  const seedPointIds = entityPointIds(seed);
  const outputPointIds = entityPointIds(output);
  if (seedPointIds.length === 0 || seedPointIds.length !== outputPointIds.length) {
    return null;
  }

  const displacements = seedPointIds.map((seedPointId, index) => {
    const seedPoint = pointsById.get(seedPointId);
    const outputPoint = pointsById.get(outputPointIds[index]!);
    return seedPoint && outputPoint
      ? ([outputPoint.position[0] - seedPoint.position[0], outputPoint.position[1] - seedPoint.position[1]] as const)
      : null;
  });
  if (displacements.some((displacement) => displacement === null)) {
    return null;
  }

  const summed = (displacements as readonly (readonly [number, number])[]).reduce(
    (sum, displacement) => [sum[0] + displacement[0], sum[1] + displacement[1]] as SketchPoint2D,
    [0, 0] as SketchPoint2D,
  );
  return [summed[0] / displacements.length, summed[1] / displacements.length];
}

function averageLinearPatternVector(vectors: readonly SketchPoint2D[]): SketchPoint2D | null {
  if (vectors.length === 0) {
    return null;
  }
  const sum = vectors.reduce(
    (total, vector) => [total[0] + vector[0], total[1] + vector[1]] as SketchPoint2D,
    [0, 0] as SketchPoint2D,
  );
  const average: SketchPoint2D = [sum[0] / vectors.length, sum[1] / vectors.length];
  if (Math.hypot(average[0], average[1]) <= LINEAR_PATTERN_VECTOR_TOLERANCE) {
    return null;
  }
  const isConsistent = vectors.every(
    (vector) => Math.hypot(vector[0] - average[0], vector[1] - average[1]) <= LINEAR_PATTERN_VECTOR_TOLERANCE,
  );
  return isConsistent ? average : null;
}

function pointForEntityRole(
  entity: SketchEntityDefinition,
  role: "start" | "end" | "center" | "point",
  pointsById: ReadonlyMap<SketchPointId, SketchPointDefinition>,
): SketchPoint2D | null {
  switch (entity.kind) {
    case "lineSegment":
      return pointsById.get(role === "end" ? entity.endPointId : entity.startPointId)?.position ?? null;
    case "circle":
      return pointsById.get(entity.centerPointId)?.position ?? null;
    case "arc": {
      const pointId =
        role === "start"
          ? entity.startPointId
          : role === "end"
            ? entity.endPointId
            : entity.centerPointId;
      return pointsById.get(pointId)?.position ?? null;
    }
    case "point":
      return pointsById.get(entity.pointId)?.position ?? null;
    default:
      return null;
  }
}

function firstHalfSpaceSign(record: OnshapeSketchConstraint): 1 | -1 | null {
  const halfSpace = record.parameters.find(
    (entry) =>
      entry.parameterId.toLowerCase().startsWith("halfspace") &&
      typeof entry.value === "string",
  )?.value;
  if (halfSpace === "LEFT") {
    return 1;
  }
  if (halfSpace === "RIGHT") {
    return -1;
  }
  return null;
}

function radiusForCircleLike(
  entity: SketchEntityDefinition,
  pointsById: ReadonlyMap<SketchPointId, SketchPointDefinition>,
): number | null {
  if (entity.kind === "circle") {
    return entity.radius;
  }
  if (entity.kind !== "arc") {
    return null;
  }
  const center = pointForEntityRole(entity, "center", pointsById);
  const start = pointForEntityRole(entity, "start", pointsById);
  return center && start ? Math.hypot(start[0] - center[0], start[1] - center[1]) : null;
}

function signedOffsetDistance(input: {
  seed: SketchEntityDefinition;
  output: SketchEntityDefinition;
  pointsById: ReadonlyMap<SketchPointId, SketchPointDefinition>;
  halfSpaceSign: 1 | -1 | null;
}): number | null {
  const { seed, output, pointsById, halfSpaceSign } = input;
  if (seed.kind === "lineSegment" && output.kind === "lineSegment") {
    const seedStart = pointForEntityRole(seed, "start", pointsById);
    const seedEnd = pointForEntityRole(seed, "end", pointsById);
    const outputStart = pointForEntityRole(output, "start", pointsById);
    const outputEnd = pointForEntityRole(output, "end", pointsById);
    if (!seedStart || !seedEnd || !outputStart || !outputEnd) {
      return null;
    }
    const dx = seedEnd[0] - seedStart[0];
    const dy = seedEnd[1] - seedStart[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      return null;
    }
    const normal: SketchPoint2D = [-dy / length, dx / length];
    const startDistance =
      (outputStart[0] - seedStart[0]) * normal[0] +
      (outputStart[1] - seedStart[1]) * normal[1];
    const endDistance =
      (outputEnd[0] - seedEnd[0]) * normal[0] +
      (outputEnd[1] - seedEnd[1]) * normal[1];
    const signed = (startDistance + endDistance) / 2;
    return halfSpaceSign === null ? signed : Math.abs(signed) * halfSpaceSign;
  }

  if (
    (seed.kind === "circle" || seed.kind === "arc") &&
    (output.kind === "circle" || output.kind === "arc")
  ) {
    const seedRadius = radiusForCircleLike(seed, pointsById);
    const outputRadius = radiusForCircleLike(output, pointsById);
    if (seedRadius == null || outputRadius == null) {
      return null;
    }
    // The offset contract measures distance to the left of traversal: a
    // counter-clockwise circle/arc SHRINKS by a positive distance, and a
    // clockwise arc grows. Reporting the raw radius delta inverts that sign and
    // makes an authored outward offset collapse the curve at solve time.
    const shrinksWithPositiveDistance =
      seed.kind === "circle" || seed.sweepDirection === "counterClockwise";
    const signed = shrinksWithPositiveDistance
      ? seedRadius - outputRadius
      : outputRadius - seedRadius;
    return halfSpaceSign === null ? signed : Math.abs(signed) * halfSpaceSign;
  }

  return null;
}

function normalizeOffsetDistance(input: {
  record: OnshapeSketchConstraint;
  seeds: readonly SketchEntityDefinition[];
  outputs: readonly SketchEntityDefinition[];
  pointsById: ReadonlyMap<SketchPointId, SketchPointDefinition>;
}): SketchDimensionAuthoredValue | null {
  const halfSpaceSign = firstHalfSpaceSign(input.record);
  const distances = input.seeds
    .map((seed, index) =>
      signedOffsetDistance({
        seed,
        output: input.outputs[index]!,
        pointsById: input.pointsById,
        halfSpaceSign,
      }),
    )
    .filter((distance): distance is number =>
      distance !== null && Number.isFinite(distance),
    );
  if (distances.length === 0) {
    return null;
  }
  const average = distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
  return createLiteralAuthoredValue(average);
}

function translateDerivationRecord(input: {
  featureId: string;
  record: OnshapeSketchConstraint;
  maps: TranslationMaps;
  pointsById: ReadonlyMap<SketchPointId, SketchPointDefinition>;
  diagnostics: SketchTranslationDiagnostic[];
}): SketchDerivationDefinition | null {
  const { featureId, record, maps, pointsById, diagnostics } = input;
  const id = derivationId(featureId, record.entityId);
  const label = record.entityId;

  switch (record.constraintType) {
    case "MIRROR": {
      const seedOperand = parseOperand(stringParameter(record, "localFirst"), maps);
      const outputOperand = parseOperand(stringParameter(record, "localSecond"), maps);
      const mirrorOperand = parseOperand(stringParameter(record, "localMirror"), maps);
      if (
        seedOperand.kind !== "entity" ||
        outputOperand.kind !== "entity" ||
        mirrorOperand.kind !== "entity"
      ) {
        break;
      }
      const seed = maps.entitiesByRawId.get(stringParameter(record, "localFirst") ?? "");
      const output = maps.entitiesByRawId.get(stringParameter(record, "localSecond") ?? "");
      if (!seed || !output) {
        break;
      }
      return {
        derivationId: id,
        kind: "mirror",
        label,
        seedEntityIds: [seed.entityId],
        outputs: [makeOutput(seed, output, 1)],
        mirrorReference: { kind: "lineEntity", entityId: mirrorOperand.entityId },
      };
    }
    case "OFFSET": {
      const seeds: SketchEntityDefinition[] = [];
      const derivedEntities: SketchEntityDefinition[] = [];
      const outputs: ReturnType<typeof makeOutput>[] = [];
      for (const [masterKey, offsetKey] of [
        ["localMaster", "localOffset"],
        ["externalMaster", "localOffset"],
        ["externalSecond", "localSecondOffset"],
      ] as const) {
        const masterRaw = stringParameter(record, masterKey);
        const offsetRaw = stringParameter(record, offsetKey);
        const master = masterRaw ? maps.entitiesByRawId.get(masterRaw) : undefined;
        const output = offsetRaw ? maps.entitiesByRawId.get(offsetRaw) : undefined;
        if (master && output) {
          seeds.push(master);
          derivedEntities.push(output);
          outputs.push(makeOutput(master, output, 1));
        }
      }
      if (outputs.length === 0) {
        break;
      }
      const distance = normalizeOffsetDistance({
        record,
        seeds,
        outputs: derivedEntities,
        pointsById,
      });
      if (!distance) {
        break;
      }
      return {
        derivationId: id,
        kind: "offset",
        label,
        seedEntityIds: seeds.map((seed) => seed.entityId),
        outputs,
        distance,
        jointPolicy: "trimExtendArcFallback",
        jointOutputs: [],
      };
    }
    case "LINEAR_PATTERN": {
      const directions = new Map<number, Map<number, Map<number, SketchEntityDefinition>>>();
      for (const parameterRecord of record.parameters) {
        const match = parameterRecord.parameterId.match(/^localInstance(\d+),(\d+),(\d+)$/);
        if (!match || typeof parameterRecord.value !== "string") {
          continue;
        }
        const entitySlot = Number(match[1]);
        const directionIndex = Number(match[2]);
        const instanceIndex = Number(match[3]);
        const entity = maps.entitiesByRawId.get(parameterRecord.value);
        if (!entity) {
          continue;
        }
        const instances = directions.get(directionIndex) ?? new Map<number, Map<number, SketchEntityDefinition>>();
        const slots = instances.get(instanceIndex) ?? new Map<number, SketchEntityDefinition>();
        slots.set(entitySlot, entity);
        instances.set(instanceIndex, slots);
        directions.set(directionIndex, instances);
      }

      if (directions.size !== 1) {
        dropRelationship(diagnostics, record, "linear pattern has no supported single local direction group");
        return null;
      }
      const instances = [...directions.values()][0]!;
      const seedsBySlot = instances.get(0) ?? new Map<number, SketchEntityDefinition>();
      const outputEntries = [...instances.entries()].filter(([instance]) => instance > 0);
      if (seedsBySlot.size === 0 || outputEntries.length === 0) {
        break;
      }

      const outputs: ReturnType<typeof makeOutput>[] = [];
      const perInstanceVectors: SketchPoint2D[] = [];
      for (const [instance, slots] of outputEntries) {
        for (const [slot, output] of slots) {
          const seed = seedsBySlot.get(slot);
          if (!seed) {
            continue;
          }
          const displacement = entityPatternDisplacement({ seed, output, pointsById });
          if (!displacement) {
            continue;
          }
          outputs.push(makeOutput(seed, output, instance));
          perInstanceVectors.push([displacement[0] / instance, displacement[1] / instance]);
        }
      }
      const vector = averageLinearPatternVector(perInstanceVectors);
      if (outputs.length === 0 || !vector) {
        dropRelationship(diagnostics, record, "linear pattern vector could not be derived from translated nonzero geometry");
        return null;
      }
      return {
        derivationId: id,
        kind: "linearPattern",
        label,
        seedEntityIds: [...seedsBySlot.values()].map((seed) => seed.entityId),
        outputs,
        vector,
        instanceCount: Math.max(...instances.keys()) + 1,
      };
    }
  }

  dropRelationship(diagnostics, record, "derivation operands did not resolve to a supported local relationship");
  return null;
}

type VerifiableRelationship =
  | { kind: "constraint"; id: ConstraintId; relationshipKind: string; constraint: ConstraintDefinition }
  | { kind: "dimension"; id: DimensionId; relationshipKind: string; dimension: DimensionDefinition };

function numericAuthoredValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const authored = value as { source?: unknown; value?: unknown; valueText?: unknown };
  if (authored.source === "literal" && typeof authored.value === "number" && Number.isFinite(authored.value)) {
    return authored.value;
  }
  if (authored.source === "expression" && typeof authored.valueText === "string") {
    const numeric = Number(authored.valueText);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function dimensionForSolve(dimension: DimensionDefinition): DimensionDefinition | null {
  if ("valueRadians" in dimension) {
    const numeric = numericAuthoredValue(dimension.valueRadians);
    return numeric === null ? null : ({ ...dimension, valueRadians: numeric } as DimensionDefinition);
  }
  if ("value" in dimension) {
    const numeric = numericAuthoredValue(dimension.value);
    return numeric === null ? null : ({ ...dimension, value: numeric } as DimensionDefinition);
  }
  return null;
}

function verifiableRelationships(definition: SketchDefinition): VerifiableRelationship[] {
  return [
    ...definition.constraints.map((constraint) => ({
      kind: "constraint" as const,
      id: constraint.constraintId,
      relationshipKind: constraint.kind,
      constraint,
    })),
    ...definition.dimensions.flatMap((dimension) => {
      const normalized = dimensionForSolve(dimension);
      return normalized
        ? [
            {
              kind: "dimension" as const,
              id: dimension.dimensionId,
              relationshipKind: dimension.kind,
              dimension: normalized,
            },
          ]
        : [];
    }),
  ];
}

function definitionWithRelationships(
  definition: SketchDefinition,
  relationships: readonly VerifiableRelationship[],
): SketchDefinition {
  const constraints = relationships
    .filter((relationship): relationship is Extract<VerifiableRelationship, { kind: "constraint" }> => relationship.kind === "constraint")
    .map((relationship) => relationship.constraint);
  const dimensions = relationships
    .filter((relationship): relationship is Extract<VerifiableRelationship, { kind: "dimension" }> => relationship.kind === "dimension")
    .map((relationship) => relationship.dimension);
  return {
    ...definition,
    constraintIds: constraints.map((constraint) => constraint.constraintId),
    constraints,
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
    dimensions,
  };
}

function definitionWithoutRelationships(
  definition: SketchDefinition,
  relationships: readonly VerifiableRelationship[],
): SketchDefinition {
  const droppedConstraintIds = new Set(
    relationships
      .filter((relationship) => relationship.kind === "constraint")
      .map((relationship) => relationship.id),
  );
  const droppedDimensionIds = new Set(
    relationships
      .filter((relationship) => relationship.kind === "dimension")
      .map((relationship) => relationship.id),
  );
  const constraints = definition.constraints.filter(
    (constraint) => !droppedConstraintIds.has(constraint.constraintId),
  );
  const dimensions = definition.dimensions.filter(
    (dimension) => !droppedDimensionIds.has(dimension.dimensionId),
  );
  return {
    ...definition,
    constraintIds: constraints.map((constraint) => constraint.constraintId),
    constraints,
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
    dimensions,
  };
}

function solvedDeviation(
  definition: SketchDefinition,
  solvedPoints: readonly { pointId: SketchPointId; solvedPosition: SketchPoint2D }[],
): number {
  const solvedById = new Map(solvedPoints.map((point) => [point.pointId, point.solvedPosition]));
  let maxDeviation = 0;
  for (const point of definition.points) {
    const solved = solvedById.get(point.pointId);
    if (!solved) {
      return Number.POSITIVE_INFINITY;
    }
    maxDeviation = Math.max(
      maxDeviation,
      Math.hypot(solved[0] - point.position[0], solved[1] - point.position[1]),
    );
  }
  return maxDeviation;
}

export async function verifySketchTranslationSolveConsistency(
  input: SketchSolveConsistencyInput,
): Promise<SketchSolveConsistencyResult> {
  const tolerance = input.tolerance ?? 1e-3;
  const relationships = verifiableRelationships(input.definition);
  let requestSequence = 0;

  const solveDefinition = async (definition: SketchDefinition) => {
    requestSequence += 1;
    return input.solver.solveSketch({
      contractVersion: input.contractVersion,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: `request_import_solve_consistency_${sanitizeId(input.sketchId)}_${requestSequence}` as RequestId,
      documentId: input.documentId,
      revisionId: input.revisionId,
      sketchId: input.sketchId,
      plane: input.plane.frame,
      tolerances: {
        coincidence: tolerance,
        angleRadians: 1e-4,
        minimumSegmentLength: tolerance,
      },
      partialSolvePolicy: "failOnConflict",
      definition,
      projectedReferences: [],
    });
  };

  const isBad = async (candidate: readonly VerifiableRelationship[]) => {
    const definition = definitionWithRelationships(input.definition, candidate);
    const response = await solveDefinition(definition);
    return (
      response.status.solveState === "failed" ||
      solvedDeviation(definition, response.solvedSnapshot.solvedPoints) > tolerance
    );
  };

  let definition = input.definition;
  let diagnostics: SketchTranslationDiagnostic[] = [];
  let relationshipSummary = input.relationshipSummary;

  if (relationships.length > 0 && (await isBad(relationships))) {
    const isolate = async (
      candidate: readonly VerifiableRelationship[],
    ): Promise<VerifiableRelationship[]> => {
      if (candidate.length <= 1) {
        return [...candidate];
      }
      const midpoint = Math.floor(candidate.length / 2);
      const left = candidate.slice(0, midpoint);
      const right = candidate.slice(midpoint);
      const offenders: VerifiableRelationship[] = [];
      if (left.length > 0 && (await isBad(left))) {
        offenders.push(...(await isolate(left)));
      }
      if (right.length > 0 && (await isBad(right))) {
        offenders.push(...(await isolate(right)));
      }
      return offenders.length > 0 ? offenders : [...candidate];
    };

    const isolated = await isolate(relationships);
    definition = definitionWithoutRelationships(input.definition, isolated);
    const droppedConstraints = isolated.filter(
      (relationship) => relationship.kind === "constraint",
    ).length;
    const droppedDimensions = isolated.filter(
      (relationship) => relationship.kind === "dimension",
    ).length;
    diagnostics = isolated.map((relationship) => ({
      code: "onshape-sketch-solve-consistency-failed" as const,
      message: `Sketch relationship "${relationship.id}" (${relationship.relationshipKind}) was dropped: solve consistency moved seeded geometry beyond tolerance.`,
      relationshipKind: relationship.relationshipKind,
      operands: [relationship.id],
      reason: "solve-consistency",
    }));
    relationshipSummary = {
      constraints: {
        carried: Math.max(
          0,
          input.relationshipSummary.constraints.carried - droppedConstraints,
        ),
        dropped:
          input.relationshipSummary.constraints.dropped + droppedConstraints,
      },
      dimensions: {
        carried: Math.max(
          0,
          input.relationshipSummary.dimensions.carried - droppedDimensions,
        ),
        dropped: input.relationshipSummary.dimensions.dropped + droppedDimensions,
      },
      derivations: input.relationshipSummary.derivations,
    };
  }

  if (input.sourceSolveStatus === "WELL_DEFINED" && definition.points.length > 0) {
    const perturbDistance = Math.max(1, tolerance * 100);
    const hasResidualMobility = async (candidate: SketchDefinition) => {
      const solveReady = definitionWithRelationships(
        candidate,
        verifiableRelationships(candidate),
      );
      const perturbed: SketchDefinition = {
        ...solveReady,
        points: solveReady.points.map((point) => ({
          ...point,
          position: [
            point.position[0] + perturbDistance,
            point.position[1] + perturbDistance * 0.75,
          ],
        })),
      };
      const response = await solveDefinition(perturbed);
      return (
        response.status.solveState !== "failed" &&
        solvedDeviation(candidate, response.solvedSnapshot.solvedPoints) > tolerance
      );
    };

    if (await hasResidualMobility(definition)) {
      const preferredPoints = definition.points.filter(
        (point) => !point.isConstruction,
      );
      const candidates = preferredPoints.length > 0 ? preferredPoints : definition.points;
      const first = candidates[0]!;
      const second = candidates
        .slice(1)
        .sort(
          (left, right) =>
            Math.hypot(
              right.position[0] - first.position[0],
              right.position[1] - first.position[1],
            ) -
            Math.hypot(
              left.position[0] - first.position[0],
              left.position[1] - first.position[1],
            ),
        )[0];
      const groundingPoints = second ? [first, second] : [first];
      let remainsMobile = true;
      let groundedPointCount = 0;

      for (const point of groundingPoints) {
        groundedPointCount += 1;
        const groundingConstraint: ConstraintDefinition = {
          constraintId:
            `constraint_${sanitizeId(input.sketchId)}_import_ground_${groundedPointCount}` as ConstraintId,
          kind: "fixPoint",
          label: `Imported source anchor ${groundedPointCount}`,
          pointId: point.pointId,
          position: point.position,
        };
        definition = {
          ...definition,
          constraintIds: [
            ...definition.constraintIds,
            groundingConstraint.constraintId,
          ],
          constraints: [...definition.constraints, groundingConstraint],
        };
        remainsMobile = await hasResidualMobility(definition);
        if (!remainsMobile) {
          break;
        }
      }

      diagnostics.push({
        code: remainsMobile
          ? "onshape-sketch-residual-mobility"
          : "onshape-sketch-residual-mobility-grounded",
        message: remainsMobile
          ? `Source sketch ${input.sketchId} was WELL_DEFINED, but translated geometry remained mobile after grounding ${groundedPointCount} suitable points.`
          : `Source sketch ${input.sketchId} was WELL_DEFINED; ${groundedPointCount} suitable point anchor${groundedPointCount === 1 ? " was" : "s were"} carried to replace residual rigid motion from unavailable external references.`,
        relationshipKind: "fixPoint",
        operands: definition.constraints
          .filter((constraint) => constraint.kind === "fixPoint")
          .slice(-groundedPointCount)
          .map((constraint) => constraint.constraintId),
        reason: remainsMobile
          ? "residual-mobility-after-grounding"
          : "source-well-defined-residual-mobility-grounded",
      });
    }
  }

  return { definition, diagnostics, relationshipSummary };
}

/** Translate one Onshape solved sketch into a cadara sketch commit definition. */
export function translateSketch(
  input: SketchTranslationInput,
): SketchTranslationResult {
  const points: SketchPointDefinition[] = [];
  const entities: SketchEntityDefinition[] = [];
  const constraints: ConstraintDefinition[] = [];
  const dimensions: DimensionDefinition[] = [];
  const derivedRelationships: SketchDerivationDefinition[] = [];
  const diagnostics: SketchTranslationDiagnostic[] = [];
  const relationshipSummary: SketchRelationshipSummary = {
    constraints: { carried: 0, dropped: 0 },
    dimensions: { carried: 0, dropped: 0 },
    derivations: { carried: 0, dropped: 0 },
  };
  const maps: TranslationMaps = {
    entitiesByRawId: new Map(),
    pointsByRawOperand: new Map(),
  };
  const plane =
    input.plane ?? (input.planeKey ? planeDefinition(input.planeKey) : null);
  if (!plane) {
    throw new Error("Sketch translation requires a datum or probed face plane.");
  }

  // Placeholder owning-sketch id; the commit path remaps every entity/point
  // target sketchId to the durable sketch id it allocates on commit.
  const owningSketchId = `sketch_pending_${sanitizeId(input.featureId)}` as SketchId;

  const addPoint = (
    ownerRaw: string,
    role: string,
    position: SketchPoint2D,
    isConstruction: boolean,
  ): SketchPointId => {
    const id = pointId(input.featureId, `${sanitizeId(ownerRaw)}_${role}`);
    points.push({
      pointId: id,
      label: `${ownerRaw}.${role}`,
      target: { kind: "sketchPoint", sketchId: owningSketchId, pointId: id },
      position,
      isConstruction,
    });
    maps.pointsByRawOperand.set(`${ownerRaw}.${role}`, id);
    if (role === "point") {
      maps.pointsByRawOperand.set(ownerRaw, id);
    }
    return id;
  };

  for (const entity of input.entities) {
    const isConstruction = entity.isConstruction === true;
    const eid = entityId(input.featureId, entity.entityId);
    const target = {
      kind: "sketchEntity" as const,
      sketchId: owningSketchId,
      entityId: eid,
    };

    switch (entity.entityType) {
      case "lineSegment": {
        if (!entity.start || !entity.end) {
          diagnostics.push({
            code: "onshape-sketch-degenerate-entity",
            message: `Line "${entity.entityId}" had no solved endpoints and was skipped.`,
            entityId: entity.entityId,
            entityType: entity.entityType,
          });
          break;
        }
        const startPointId = addPoint(entity.entityId, "start", entity.start, isConstruction);
        const endPointId = addPoint(entity.entityId, "end", entity.end, isConstruction);
        const definition: SketchEntityDefinition = {
          kind: "lineSegment",
          entityId: eid,
          label: entity.entityId,
          target,
          isConstruction,
          startPointId,
          endPointId,
        };
        entities.push(definition);
        maps.entitiesByRawId.set(entity.entityId, definition);
        break;
      }
      case "circle": {
        if (!entity.center || entity.radius === undefined || entity.radius <= 0) {
          diagnostics.push({
            code: "onshape-sketch-degenerate-entity",
            message: `Circle "${entity.entityId}" had no solved center/radius and was skipped.`,
            entityId: entity.entityId,
            entityType: entity.entityType,
          });
          break;
        }
        const centerPointId = addPoint(entity.entityId, "center", entity.center, isConstruction);
        const definition: SketchEntityDefinition = {
          kind: "circle",
          entityId: eid,
          label: entity.entityId,
          target,
          isConstruction,
          centerPointId,
          radius: entity.radius,
        };
        entities.push(definition);
        maps.entitiesByRawId.set(entity.entityId, definition);
        break;
      }
      case "arc": {
        if (!entity.center || !entity.start || !entity.end) {
          diagnostics.push({
            code: "onshape-sketch-degenerate-entity",
            message: `Arc "${entity.entityId}" had incomplete solved geometry and was skipped.`,
            entityId: entity.entityId,
            entityType: entity.entityType,
          });
          break;
        }
        const centerPointId = addPoint(entity.entityId, "center", entity.center, isConstruction);
        const startPointId = addPoint(entity.entityId, "start", entity.start, isConstruction);
        const endPointId = addPoint(entity.entityId, "end", entity.end, isConstruction);
        const definition: SketchEntityDefinition = {
          kind: "arc",
          entityId: eid,
          label: entity.entityId,
          target,
          isConstruction,
          centerPointId,
          startPointId,
          endPointId,
          sweepDirection: entity.sweepDirection ?? "counterClockwise",
        };
        entities.push(definition);
        maps.entitiesByRawId.set(entity.entityId, definition);
        break;
      }
      case "point": {
        const position = entity.position ?? entity.center;
        if (!position) {
          diagnostics.push({
            code: "onshape-sketch-degenerate-entity",
            message: `Point "${entity.entityId}" had no solved position and was skipped.`,
            entityId: entity.entityId,
            entityType: entity.entityType,
          });
          break;
        }
        const refPointId = addPoint(entity.entityId, "point", position, isConstruction);
        const definition: SketchEntityDefinition = {
          kind: "point",
          entityId: eid,
          label: entity.entityId,
          target,
          isConstruction,
          pointId: refPointId,
        };
        entities.push(definition);
        maps.entitiesByRawId.set(entity.entityId, definition);
        break;
      }
      default: {
        diagnostics.push({
          code: "onshape-sketch-unsupported-entity",
          message: `Entity "${entity.entityId}" of kind "${entity.entityType}" is outside cadara's sketch vocabulary and was dropped.`,
          entityId: entity.entityId,
          entityType: entity.entityType,
        });
      }
    }
  }

  const pointsById = new Map(points.map((point) => [point.pointId, point]));

  for (const record of input.constraints ?? []) {
    if (DIMENSION_KINDS.has(record.constraintType)) {
      const before = diagnostics.length;
      const dimension = translateDimensionRecord({ featureId: input.featureId, record, maps, diagnostics });
      if (dimension) {
        dimensions.push(dimension);
        relationshipSummary.dimensions.carried += 1;
      } else if (diagnostics.length > before) {
        relationshipSummary.dimensions.dropped += 1;
      }
      continue;
    }
    if (DERIVATION_KINDS.has(record.constraintType)) {
      const before = diagnostics.length;
      const derivation = translateDerivationRecord({ featureId: input.featureId, record, maps, pointsById, diagnostics });
      if (derivation) {
        derivedRelationships.push(derivation);
        relationshipSummary.derivations.carried += 1;
      } else if (diagnostics.length > before) {
        relationshipSummary.derivations.dropped += 1;
      }
      continue;
    }
    if (record.constraintType === "PROJECTED") {
      dropRelationship(diagnostics, record, "projected/external references remain gated until projection geometry is imported");
      relationshipSummary.constraints.dropped += 1;
      continue;
    }
    const before = diagnostics.length;
    const constraint = translateConstraintRecord({ featureId: input.featureId, record, maps, diagnostics });
    if (constraint) {
      constraints.push(constraint);
      relationshipSummary.constraints.carried += 1;
    } else if (diagnostics.length > before) {
      relationshipSummary.constraints.dropped += 1;
    }
  }

  const definition = normalizeCoincidentPointTopology({
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: [],
    references: [],
    pointIds: points.map((point) => point.pointId),
    points,
    entityIds: entities.map((entity) => entity.entityId),
    entities,
    constraintIds: constraints.map((constraint) => constraint.constraintId),
    constraints,
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
    dimensions,
    styleIds: [],
    styles: [],
    svgRenderingEnabled: true,
    derivedRelationships,
    authoringOperations: [],
  });

  return {
    plane,
    definition,
    diagnostics,
    relationshipSummary,
    sourceSolveStatus: input.sourceSolveStatus,
  };
}

// Referenced only to keep the exhaustive kind list discoverable for reviewers.
export const SUPPORTED_SOLVED_ENTITY_KINDS: readonly SolvedSketchEntityKind[] = [
  "lineSegment",
  "circle",
  "arc",
  "point",
];
