/**
 * Sketch translator (2.3).
 *
 * Translates an Onshape solved sketch into a cadara `CommitSketchRequest`
 * definition on a canonical datum plane, seeding point geometry from Onshape's
 * solved positions so under-constrained sketches do not drift on import.
 * Supported entity kinds (line/circle/arc/point) translate table-driven;
 * supported local constraints, dimensions, and derivations are carried when
 * their operands resolve against the translated sketch graph. Preclassified
 * external point/line references can supply projected constraint operands;
 * unsupported records degrade per-record with structured diagnostics.
 */
import type {
  ImportDeferredSketchDefinition,
  ImportDeferredSketchReferenceDefinition,
} from "@/contracts/import/actions";
import { createExpressionAuthoredValue } from "@/contracts/modeling/authored-values";
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
  type ProjectedSketchGeometryConstraintOperand,
  type SketchDefinition,
  type SketchDerivationDefinition,
  type SketchDimensionAuthoredValue,
  type SketchEntityDefinition,
  type SketchOffsetPair,
  type SketchPoint2D,
  type SketchPointDefinition,
} from "@/contracts/sketch/schema";

import { translateOnshapeExpression } from "@/domain/import/onshape/expression-translator";
import type { SketchSolverAdapter } from "@/contracts/solver/adapter";
import {
  SOLVER_SCHEMA_VERSION,
  type ProjectedSketchReferenceRecord,
} from "@/contracts/solver/schema";
import type { OnshapeSketchConstraint } from "@/domain/import/onshape/bundle-reader";
import { createProjectedGeometryId } from "@/domain/modeling/sketch-reference-projection";

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
  /** Exact authored startParam→endParam direction, projected into this sketch frame. */
  authoredParameterDirection?: SketchPoint2D;
  center?: SketchPoint2D;
  radius?: number;
  position?: SketchPoint2D;
  sweepDirection?: "clockwise" | "counterClockwise";
}

export type SketchExternalReferenceVerificationGeometry =
  | {
      kind: "point";
      position3d: readonly [number, number, number];
    }
  | {
      kind: "lineSegment";
      start3d: readonly [number, number, number];
      end3d: readonly [number, number, number];
    };

export interface SketchExternalReference {
  definition: ImportDeferredSketchReferenceDefinition;
  geometryKind: "point" | "lineSegment";
  /** Captured authoritative geometry used only for pre-commit consistency verification. */
  verificationGeometry?: SketchExternalReferenceVerificationGeometry;
}

export interface SketchTranslationInput {
  featureId: string;
  label: string;
  planeKey?: SketchPlaneKey;
  plane?: SketchPlaneDefinition;
  /** Onshape's authored sketch-coordinate frame for directional constraints. */
  sourceFrame?: SketchPlaneFrame;
  /** Frame into which `entities` were projected; defaults to the output plane frame. */
  projectionFrame?: SketchPlaneFrame;
  entities: readonly SolvedSketchEntityGeometry[];
  constraints?: readonly OnshapeSketchConstraint[];
  sourceSolveStatus?: string;
  externalReferences?: ReadonlyMap<string, SketchExternalReference>;
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
  projectedReferences: ProjectedSketchReferenceRecord[];
  diagnostics: SketchTranslationDiagnostic[];
  relationshipSummary: SketchRelationshipSummary;
  sourceSolveStatus?: string;
}

function normalizeCoincidentPointTopology<T extends ImportDeferredSketchDefinition>(definition: T): T {
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
  ) as T;
  normalized.points = normalized.points.filter(
    (point, index, all) =>
      all.findIndex((candidate) => candidate.pointId === point.pointId) === index,
  );
  normalized.pointIds = normalized.points.map((point) => point.pointId);
  return normalized;
}

export interface SketchSolveConsistencyInput {
  solver: Pick<SketchSolverAdapter, "solveSketch">;
  contractVersion: ContractVersion;
  documentId: DocumentId;
  revisionId: RevisionId;
  sketchId: SketchId;
  plane: SketchPlaneDefinition;
  definition: ImportDeferredSketchDefinition;
  projectedReferences?: readonly ProjectedSketchReferenceRecord[];
  relationshipSummary: SketchRelationshipSummary;
  sourceSolveStatus?: string;
  tolerance?: number;
}

export interface SketchSolveConsistencyResult {
  definition: ImportDeferredSketchDefinition;
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
  externalReferences: NonNullable<SketchTranslationInput["externalReferences"]>;
}

type ParsedOperand =
  | { kind: "point"; raw: string; pointId: SketchPointId }
  | { kind: "entity"; raw: string; entityId: SketchEntityId }
  | {
      kind: "external";
      raw: string;
      operand: ProjectedSketchGeometryConstraintOperand;
      geometryKind: "point" | "lineSegment";
    }
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
const DERIVATION_KINDS = new Set(["MIRROR", "LINEAR_PATTERN"]);
const LINEAR_PATTERN_VECTOR_TOLERANCE = 1e-4;
const AXIS_ALIGNMENT_TOLERANCE = 1e-4;

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

function firstConstraintOperand(
  record: OnshapeSketchConstraint,
  parameterIds: readonly string[],
  maps: TranslationMaps,
): string | null {
  for (const parameterId of parameterIds) {
    const entry = parameter(record, parameterId);
    if (typeof entry?.value === "string") return entry.value;
    const externalIds = entry?.queries
      ?.flatMap((query) => query.deterministicIds)
      .filter((id) => maps.externalReferences.has(id)) ?? [];
    if (entry?.hasExternalQuery && externalIds.length === 1) return externalIds[0]!;
  }
  return null;
}

function rawOperands(record: OnshapeSketchConstraint): string[] {
  return record.parameters
    .filter((entry) => {
      const id = entry.parameterId.toLowerCase();
      return id.startsWith("local") || id.startsWith("external");
    })
    .flatMap((entry) => {
      if (typeof entry.value === "string") return [entry.value];
      return entry.queries?.flatMap((query) => query.deterministicIds) ?? [];
    });
}

function parseOperand(raw: string | null, maps: TranslationMaps): ParsedOperand {
  if (!raw) {
    return { kind: "missing", raw: "" };
  }
  const external = maps.externalReferences.get(raw);
  if (external) {
    const referenceId = external.definition.referenceId;
    return {
      kind: "external",
      raw,
      geometryKind: external.geometryKind,
      operand: {
        kind: "projectedGeometry",
        reference: {
          kind: external.geometryKind === "point" ? "projectedPoint" : "projectedLineSegment",
          referenceId,
          geometryId: createProjectedGeometryId(
            referenceId,
            external.geometryKind === "point" ? "point" : "edge",
          ),
        },
      },
    };
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

function translatedDirectionalConstraintKind(input: {
  sourceKind: "horizontal" | "vertical";
  sourceFrame?: SketchPlaneFrame;
  projectionFrame: SketchPlaneFrame;
}): "horizontal" | "vertical" | null {
  if (!input.sourceFrame) {
    return input.sourceKind;
  }
  const sourceAxis = input.sourceKind === "horizontal"
    ? input.sourceFrame.xAxis
    : input.sourceFrame.yAxis;
  const projectedX = dot3(sourceAxis, input.projectionFrame.xAxis);
  const projectedY = dot3(sourceAxis, input.projectionFrame.yAxis);
  const projectedNormal = dot3(sourceAxis, input.projectionFrame.normal);
  if (Math.abs(projectedNormal) > AXIS_ALIGNMENT_TOLERANCE) {
    return null;
  }
  if (
    Math.abs(projectedY) <= AXIS_ALIGNMENT_TOLERANCE &&
    Math.abs(Math.abs(projectedX) - 1) <= AXIS_ALIGNMENT_TOLERANCE
  ) {
    return "horizontal";
  }
  if (
    Math.abs(projectedX) <= AXIS_ALIGNMENT_TOLERANCE &&
    Math.abs(Math.abs(projectedY) - 1) <= AXIS_ALIGNMENT_TOLERANCE
  ) {
    return "vertical";
  }
  return null;
}

function translateConstraintRecord(input: {
  featureId: string;
  record: OnshapeSketchConstraint;
  maps: TranslationMaps;
  diagnostics: SketchTranslationDiagnostic[];
  sourceFrame?: SketchPlaneFrame;
  projectionFrame: SketchPlaneFrame;
}): ConstraintDefinition | null {
  const { featureId, record, maps, diagnostics, sourceFrame, projectionFrame } = input;
  const label = record.entityId;
  const id = constraintId(featureId, record.entityId);
  const first = parseOperand(
    firstConstraintOperand(record, [
      "localFirst",
      "localEntity1",
      "externalFirst",
      "externalEntity1",
    ], maps),
    maps,
  );
  const second = parseOperand(
    firstConstraintOperand(record, [
      "localSecond",
      "localEntity2",
      "externalSecond",
      "externalEntity2",
    ], maps),
    maps,
  );

  switch (record.constraintType) {
    case "COINCIDENT": {
      if (first.kind === "point" && second.kind === "point") {
        return { constraintId: id, kind: "coincident", label, pointIds: [first.pointId, second.pointId] };
      }
      const point = pointOperand(first) ?? pointOperand(second);
      const external = first.kind === "external" ? first : second.kind === "external" ? second : null;
      if (point && external) {
        return external.geometryKind === "point"
          ? { constraintId: id, kind: "coincidentProjectedPoint", label, point, projectedPoint: external.operand }
          : { constraintId: id, kind: "pointOnProjectedCurve", label, point, projectedCurve: external.operand };
      }
      const curve = entityOperand(first) ?? entityOperand(second);
      if (point && curve) {
        return { constraintId: id, kind: "pointOnCurve", label, point, curve };
      }
      break;
    }
    case "MIDPOINT": {
      const midpoint = parseOperand(
        firstConstraintOperand(record, [
          "localMidpoint",
          "localEntity1",
          "externalMidpoint",
          "externalEntity1",
        ], maps),
        maps,
      );
      const line = parseOperand(
        firstConstraintOperand(record, [
          "localEntity2",
          "localSecond",
          "externalEntity2",
          "externalSecond",
        ], maps),
        maps,
      );
      const point = pointOperand(midpoint);
      if (point && line.kind === "external" && line.geometryKind === "lineSegment") {
        return { constraintId: id, kind: "midpointProjectedLine", label, point, projectedLine: line.operand };
      }
      const lineEntity = entityOperand(line);
      if (point && lineEntity) {
        return { constraintId: id, kind: "midpoint", label, point, line: lineEntity };
      }
      break;
    }
    case "HORIZONTAL":
    case "VERTICAL": {
      if (first.kind === "entity") {
        const kind = translatedDirectionalConstraintKind({
          sourceKind: record.constraintType === "HORIZONTAL" ? "horizontal" : "vertical",
          sourceFrame,
          projectionFrame,
        });
        if (kind) {
          return { constraintId: id, kind, label, entityId: first.entityId };
        }
        dropRelationship(
          diagnostics,
          record,
          "authored sketch axis is not aligned with either axis of the translated sketch frame",
        );
        return null;
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
      const line = entityOperand(first) ?? entityOperand(second);
      const external = first.kind === "external" ? first : second.kind === "external" ? second : null;
      if (line && external?.geometryKind === "lineSegment") {
        return { constraintId: id, kind: "perpendicularProjectedLine", label, line, projectedLine: external.operand };
      }
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

function equalOffsetPair(input: {
  record: OnshapeSketchConstraint;
  seedParameterId: "localMaster" | "localSecond";
  offsetParameterId: "localOffset" | "localSecondOffset";
  maps: TranslationMaps;
  pointsById: ReadonlyMap<SketchPointId, SketchPointDefinition>;
}): SketchOffsetPair | null {
  const seed = input.maps.entitiesByRawId.get(
    stringParameter(input.record, input.seedParameterId) ?? "",
  );
  const offset = input.maps.entitiesByRawId.get(
    stringParameter(input.record, input.offsetParameterId) ?? "",
  );
  if (seed?.kind !== "lineSegment" || offset?.kind !== "lineSegment") {
    return null;
  }
  const seedStart = input.pointsById.get(seed.startPointId)?.position;
  const seedEnd = input.pointsById.get(seed.endPointId)?.position;
  const offsetStart = input.pointsById.get(offset.startPointId)?.position;
  if (!seedStart || !seedEnd || !offsetStart) {
    return null;
  }
  const dx = seedEnd[0] - seedStart[0];
  const dy = seedEnd[1] - seedStart[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return null;
  }
  // Preserve the side in the captured sketch frame: positive dot product with
  // the directed seed's left normal is left, negative is right. A coincident
  // capture has no justified side and therefore fails closed.
  const signedNormalDistance =
    (offsetStart[0] - seedStart[0]) * (-dy / length) +
    (offsetStart[1] - seedStart[1]) * (dx / length);
  if (signedNormalDistance === 0) {
    return null;
  }
  return {
    seedEntityId: seed.entityId,
    offsetEntityId: offset.entityId,
    side: signedNormalDistance > 0 ? "left" : "right",
  };
}

function translateEqualOffsetRecord(input: {
  featureId: string;
  record: OnshapeSketchConstraint;
  maps: TranslationMaps;
  pointsById: ReadonlyMap<SketchPointId, SketchPointDefinition>;
  diagnostics: SketchTranslationDiagnostic[];
}): Extract<ConstraintDefinition, { kind: "equalOffset" }> | null {
  const first = equalOffsetPair({
    ...input,
    seedParameterId: "localMaster",
    offsetParameterId: "localOffset",
  });
  const second = equalOffsetPair({
    ...input,
    seedParameterId: "localSecond",
    offsetParameterId: "localSecondOffset",
  });
  if (!first || !second) {
    dropRelationship(
      input.diagnostics,
      input.record,
      "equal offset requires two resolved non-coincident local line pairs",
    );
    return null;
  }
  return {
    constraintId: constraintId(input.featureId, input.record.entityId),
    kind: "equalOffset",
    label: input.record.entityId,
    pairs: [first, second],
  };
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

function verifiableRelationships(
  definition: Pick<SketchDefinition, "constraints" | "dimensions">,
): VerifiableRelationship[] {
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

/**
 * The translated sketch a pre-commit verification solve can evaluate: every
 * constraint, plus every dimension whose authored value is numeric without the
 * document's variables. This is the relationship set solve-consistency
 * verification solves; a variable-driven dimension is evaluated only at commit.
 */
export function definitionForVerificationSolve<
  T extends Pick<
    SketchDefinition,
    "constraintIds" | "constraints" | "dimensionIds" | "dimensions"
  >,
>(definition: T): T {
  return definitionWithRelationships(
    definition,
    verifiableRelationships(definition),
  );
}

function definitionWithRelationships<
  T extends Pick<
    SketchDefinition,
    "constraintIds" | "constraints" | "dimensionIds" | "dimensions"
  >,
>(definition: T, relationships: readonly VerifiableRelationship[]): T {
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
  definition: ImportDeferredSketchDefinition,
  relationships: readonly VerifiableRelationship[],
): ImportDeferredSketchDefinition {
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
  definition: ImportDeferredSketchDefinition,
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

/**
 * Build semantic geometry components for pose probing. Entity incidence is
 * deliberately stronger than the solver's scalar-variable components: the two
 * ends of a free line are one deformable shape, not two rigid bodies. Local ids
 * in constraints, dimensions, and derivations then close those entity groups.
 */
function sketchGeometryPointComponents(
  definition: ImportDeferredSketchDefinition,
): SketchPointId[][] {
  const parentByPointId = new Map<SketchPointId, SketchPointId>(
    definition.pointIds.map((id) => [id, id]),
  );
  const find = (id: SketchPointId): SketchPointId => {
    const parent = parentByPointId.get(id) ?? id;
    if (parent === id) return id;
    const root = find(parent);
    parentByPointId.set(id, root);
    return root;
  };
  const union = (ids: readonly SketchPointId[]) => {
    const first = ids[0];
    if (!first) return;
    const root = find(first);
    for (const id of ids.slice(1)) {
      parentByPointId.set(find(id), root);
    }
  };
  const pointIdsByEntityId = new Map(
    definition.entities.map((entity) => [entity.entityId, entityPointIds(entity)]),
  );

  for (const pointIds of pointIdsByEntityId.values()) {
    union(pointIds);
  }

  const localIdsIn = (
    value: unknown,
    ids: Set<SketchPointId>,
    propertyName = "",
  ): void => {
    if (typeof value === "string") {
      if (!/(?:point|entity)Ids?$/i.test(propertyName)) return;
      if (parentByPointId.has(value as SketchPointId)) {
        ids.add(value as SketchPointId);
      }
      for (const pointId of pointIdsByEntityId.get(value as SketchEntityId) ?? []) {
        ids.add(pointId);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) localIdsIn(entry, ids, propertyName);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        localIdsIn(entry, ids, key);
      }
    }
  };

  for (const relationship of [
    ...definition.constraints,
    ...definition.dimensions,
    ...(definition.derivedRelationships ?? []),
  ]) {
    const ids = new Set<SketchPointId>();
    localIdsIn(relationship, ids);
    union([...ids]);
  }

  const componentsByRoot = new Map<SketchPointId, SketchPointId[]>();
  for (const pointId of definition.pointIds) {
    const root = find(pointId);
    const component = componentsByRoot.get(root);
    if (component) component.push(pointId);
    else componentsByRoot.set(root, [pointId]);
  }
  return [...componentsByRoot.values()];
}

export async function verifySketchTranslationSolveConsistency(
  input: SketchSolveConsistencyInput,
): Promise<SketchSolveConsistencyResult> {
  const tolerance = input.tolerance ?? 1e-3;
  const relationships = verifiableRelationships(input.definition);
  let requestSequence = 0;

  const solveDefinition = async (definition: ImportDeferredSketchDefinition) => {
    const projectedReferenceIds = new Set(
      (input.projectedReferences ?? [])
        .filter((reference) => reference.status === "projected")
        .map((reference) => reference.referenceId),
    );
    const missingProjection = definition.referenceIds.find(
      (referenceId) => !projectedReferenceIds.has(referenceId),
    );
    if (missingProjection) {
      throw new Error(`Sketch solve-consistency verification is missing projected geometry for ${missingProjection}.`);
    }
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
      // Projection is materialized above. Deferred source selectors are not
      // consulted by solve once every authored reference has an exact record.
      definition: definition as unknown as SketchDefinition,
      projectedReferences: [...(input.projectedReferences ?? [])],
    });
  };

  const isBad = async (candidate: readonly VerifiableRelationship[]) => {
    const candidateDefinition = definitionWithRelationships(input.definition, candidate);
    const response = await solveDefinition(candidateDefinition);
    return (
      response.status.solveState === "failed" ||
      solvedDeviation(candidateDefinition, response.solvedSnapshot.solvedPoints) > tolerance
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
    const pointsById = new Map(definition.points.map((point) => [point.pointId, point]));
    const components = sketchGeometryPointComponents(definition);
    const rigidShapeDeviation = (
      pointIds: readonly SketchPointId[],
      solvedPoints: readonly { pointId: SketchPointId; solvedPosition: SketchPoint2D }[],
    ): number => {
      const solvedById = new Map(
        solvedPoints.map((point) => [point.pointId, point.solvedPosition]),
      );
      let maxDeviation = 0;
      for (let leftIndex = 0; leftIndex < pointIds.length; leftIndex += 1) {
        const left = pointsById.get(pointIds[leftIndex]!);
        const solvedLeft = left && solvedById.get(left.pointId);
        if (!left || !solvedLeft) return Number.POSITIVE_INFINITY;
        for (let rightIndex = leftIndex + 1; rightIndex < pointIds.length; rightIndex += 1) {
          const right = pointsById.get(pointIds[rightIndex]!);
          const solvedRight = right && solvedById.get(right.pointId);
          if (!right || !solvedRight) return Number.POSITIVE_INFINITY;
          maxDeviation = Math.max(
            maxDeviation,
            Math.abs(
              Math.hypot(
                solvedRight[0] - solvedLeft[0],
                solvedRight[1] - solvedLeft[1],
              ) - Math.hypot(
                right.position[0] - left.position[0],
                right.position[1] - left.position[1],
              ),
            ),
          );
        }
      }
      return maxDeviation;
    };
    const componentSolvedDeviation = (
      pointIds: readonly SketchPointId[],
      solvedPoints: readonly { pointId: SketchPointId; solvedPosition: SketchPoint2D }[],
    ): number => {
      const solvedById = new Map(
        solvedPoints.map((point) => [point.pointId, point.solvedPosition]),
      );
      let maxDeviation = 0;
      for (const pointId of pointIds) {
        const point = pointsById.get(pointId);
        const solved = solvedById.get(pointId);
        if (!point || !solved) return Number.POSITIVE_INFINITY;
        maxDeviation = Math.max(
          maxDeviation,
          Math.hypot(
            solved[0] - point.position[0],
            solved[1] - point.position[1],
          ),
        );
      }
      return maxDeviation;
    };
    const hasRigidPoseFreedom = async (
      candidate: ImportDeferredSketchDefinition,
      pointIds: readonly SketchPointId[],
      transform: (position: SketchPoint2D) => SketchPoint2D,
    ) => {
      const componentPointIds = new Set(pointIds);
      const solveReady = definitionWithRelationships(
        candidate,
        verifiableRelationships(candidate),
      );
      const perturbed: ImportDeferredSketchDefinition = {
        ...solveReady,
        points: solveReady.points.map((point) => componentPointIds.has(point.pointId)
          ? { ...point, position: transform(point.position) }
          : point),
      };
      const response = await solveDefinition(perturbed);
      return response.status.solveState !== "failed" &&
        componentSolvedDeviation(pointIds, response.solvedSnapshot.solvedPoints) > tolerance &&
        rigidShapeDeviation(pointIds, response.solvedSnapshot.solvedPoints) <= tolerance;
    };

    const groundingConstraints: ConstraintDefinition[] = [];
    let hasRotationFreedom = false;
    for (const componentPointIds of components) {
      const hasTranslationFreedom = await hasRigidPoseFreedom(
        definition,
        componentPointIds,
        ([x, y]) => [x + perturbDistance, y + perturbDistance * 0.75],
      );
      let groundingPoint: SketchPointDefinition | undefined;
      if (hasTranslationFreedom) {
        groundingPoint = componentPointIds
          .map((pointId) => pointsById.get(pointId))
          .find((point) => point?.isConstruction === false) ??
          pointsById.get(componentPointIds[0]!);
        if (groundingPoint) {
          const ordinal = groundingConstraints.length + 1;
          const groundingConstraint: ConstraintDefinition = {
            constraintId:
              `constraint_${sanitizeId(input.sketchId)}_import_ground_${ordinal}` as ConstraintId,
            kind: "fixPoint",
            label: `Imported source anchor ${ordinal}`,
            pointId: groundingPoint.pointId,
            position: groundingPoint.position,
          };
          groundingConstraints.push(groundingConstraint);
          definition = {
            ...definition,
            constraintIds: [...definition.constraintIds, groundingConstraint.constraintId],
            constraints: [...definition.constraints, groundingConstraint],
          };
        }
      }

      const componentPoints = componentPointIds
        .map((pointId) => pointsById.get(pointId))
        .filter((point): point is SketchPointDefinition => point !== undefined);
      const pivot = groundingPoint?.position ?? (() => {
        const sum = componentPoints.reduce(
          (total, point) => [
            total[0] + point.position[0],
            total[1] + point.position[1],
          ] as SketchPoint2D,
          [0, 0] as SketchPoint2D,
        );
        return [
          sum[0] / componentPoints.length,
          sum[1] / componentPoints.length,
        ] as SketchPoint2D;
      })();
      const rotationRadians = 0.1;
      const cosine = Math.cos(rotationRadians);
      const sine = Math.sin(rotationRadians);
      hasRotationFreedom ||= await hasRigidPoseFreedom(
        definition,
        componentPointIds,
        ([x, y]) => {
          const dx = x - pivot[0];
          const dy = y - pivot[1];
          return [
            pivot[0] + dx * cosine - dy * sine,
            pivot[1] + dx * sine + dy * cosine,
          ];
        },
      );
    }

    if (groundingConstraints.length > 0 || hasRotationFreedom) {
      diagnostics.push({
        code: hasRotationFreedom
          ? "onshape-sketch-residual-mobility"
          : "onshape-sketch-residual-mobility-grounded",
        message: hasRotationFreedom
          ? `Source sketch ${input.sketchId} was WELL_DEFINED, but translated geometry retained rigid rotation after grounding translation without capturing a variable-driven shape degree of freedom.`
          : `Source sketch ${input.sketchId} was WELL_DEFINED; ${groundingConstraints.length} component translation anchor${groundingConstraints.length === 1 ? " was" : "s were"} carried to replace residual rigid translation from unavailable external references.`,
        relationshipKind: "fixPoint",
        operands: groundingConstraints.map((constraint) => constraint.constraintId),
        reason: hasRotationFreedom
          ? "residual-rigid-rotation-after-grounding"
          : "source-well-defined-residual-mobility-grounded",
      });
    }
  }

  return { definition, diagnostics, relationshipSummary };
}

/** Translate one Onshape solved sketch into a cadara sketch commit definition. */
export function translateSketch(
  input: SketchTranslationInput & { externalReferences?: undefined },
): SketchTranslationResult;
export function translateSketch(
  input: SketchTranslationInput,
): Omit<SketchTranslationResult, "definition"> & { definition: ImportDeferredSketchDefinition };
export function translateSketch(
  input: SketchTranslationInput,
): Omit<SketchTranslationResult, "definition"> & { definition: ImportDeferredSketchDefinition } {
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
    externalReferences: input.externalReferences ?? new Map(),
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
        const solvedDirection: SketchPoint2D = [
          entity.end[0] - entity.start[0],
          entity.end[1] - entity.start[1],
        ];
        const authoredDirection = entity.authoredParameterDirection;
        const solvedOrderIsReversed = authoredDirection !== undefined &&
          solvedDirection[0] * authoredDirection[0] + solvedDirection[1] * authoredDirection[1] < 0;
        // Solved-sketch responses do not always preserve the source curve's
        // authored parameter order. Endpoint ids are authored identities, so a
        // proven opposite direction is an exact permutation, not a geometric
        // nearest-point inference. Swap before deriving directed relationships.
        const start = solvedOrderIsReversed ? entity.end : entity.start;
        const end = solvedOrderIsReversed ? entity.start : entity.end;
        const startPointId = addPoint(entity.entityId, "start", start, isConstruction);
        const endPointId = addPoint(entity.entityId, "end", end, isConstruction);
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
    if (!DIMENSION_KINDS.has(record.constraintType)) continue;
    const before = diagnostics.length;
    const dimension = translateDimensionRecord({ featureId: input.featureId, record, maps, diagnostics });
    if (dimension) {
      dimensions.push(dimension);
      relationshipSummary.dimensions.carried += 1;
    } else if (diagnostics.length > before) {
      relationshipSummary.dimensions.dropped += 1;
    }
  }

  for (const record of input.constraints ?? []) {
    if (DIMENSION_KINDS.has(record.constraintType)) continue;
    if (record.constraintType === "OFFSET") {
      const before = diagnostics.length;
      const constraint = translateEqualOffsetRecord({
        featureId: input.featureId,
        record,
        maps,
        pointsById,
        diagnostics,
      });
      if (constraint) {
        constraints.push(constraint);
        relationshipSummary.constraints.carried += 1;
      } else if (diagnostics.length > before) {
        relationshipSummary.constraints.dropped += 1;
      }
      continue;
    }
    if (DERIVATION_KINDS.has(record.constraintType)) {
      const before = diagnostics.length;
      const derivation = translateDerivationRecord({
        featureId: input.featureId,
        record,
        maps,
        pointsById,
        diagnostics,
      });
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
    const constraint = translateConstraintRecord({
      featureId: input.featureId,
      record,
      maps,
      diagnostics,
      sourceFrame: input.sourceFrame,
      projectionFrame: input.projectionFrame ?? plane.frame,
    });
    if (constraint) {
      constraints.push(constraint);
      relationshipSummary.constraints.carried += 1;
    } else if (diagnostics.length > before) {
      relationshipSummary.constraints.dropped += 1;
    }
  }

  const usedReferenceIds = new Set(constraints.flatMap((constraint) => {
    const operand = constraint.kind === "coincidentProjectedPoint"
      ? constraint.projectedPoint
      : constraint.kind === "pointOnProjectedCurve"
        ? constraint.projectedCurve
        : constraint.kind === "midpointProjectedLine" || constraint.kind === "perpendicularProjectedLine"
          ? constraint.projectedLine
          : null;
    return operand?.kind === "projectedGeometry" ? [operand.reference.referenceId] : [];
  }));
  const references = [...maps.externalReferences.values()]
    .map((entry) => entry.definition)
    .filter((reference) => usedReferenceIds.has(reference.referenceId));
  const definition = normalizeCoincidentPointTopology({
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: references.map((reference) => reference.referenceId),
    references,
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
  });
  const projectedReferences = references.flatMap((reference) => {
    const captured = [...maps.externalReferences.values()].find(
      (entry) => entry.definition.referenceId === reference.referenceId,
    )?.verificationGeometry;
    if (!captured) return [];
    return [{
      referenceId: reference.referenceId,
      status: "projected" as const,
      geometry: captured.kind === "point"
        ? [{
            geometryId: createProjectedGeometryId(reference.referenceId, "point"),
            kind: "point" as const,
            position: projectPointToSketchPlane(captured.position3d, plane),
          }]
        : [{
            geometryId: createProjectedGeometryId(reference.referenceId, "edge"),
            kind: "lineSegment" as const,
            startPosition: projectPointToSketchPlane(captured.start3d, plane),
            endPosition: projectPointToSketchPlane(captured.end3d, plane),
          }],
      diagnostics: [],
    }];
  });

  return {
    plane,
    definition,
    projectedReferences,
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
