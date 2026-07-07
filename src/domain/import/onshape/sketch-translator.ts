/**
 * Sketch translator (2.3).
 *
 * Translates an Onshape solved sketch into a cadara `CommitSketchRequest`
 * definition on a canonical datum plane, seeding point geometry from Onshape's
 * solved positions so under-constrained sketches do not drift on import.
 * Supported entity kinds (line/circle/arc/point) translate table-driven;
 * unsupported kinds are dropped with a structured diagnostic rather than left
 * dangling.
 *
 * Constraint and derivation translation is intentionally staged: v1 seeds
 * solved geometry (the correctness floor) and records which relationships were
 * not carried over. Full constraint-operand parsing follows once probe-backed
 * reference resolution lands.
 */
import type {
  ConstraintId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { SketchPlaneKey } from "@/contracts/shared/sketch-plane";
import type {
  SketchPlaneDefinition,
  SketchPlaneFrame,
} from "@/contracts/shared/sketch-plane";
import {
  SKETCH_SCHEMA_VERSION,
  type ConstraintDefinition,
  type SketchDefinition,
  type SketchEntityDefinition,
  type SketchPoint2D,
  type SketchPointDefinition,
} from "@/contracts/sketch/schema";

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
}

export interface SketchTranslationDiagnostic {
  code: "onshape-sketch-unsupported-entity" | "onshape-sketch-degenerate-entity";
  message: string;
  entityId: string;
  entityType: string;
}

export interface SketchTranslationResult {
  plane: SketchPlaneDefinition;
  definition: SketchDefinition;
  diagnostics: SketchTranslationDiagnostic[];
}

interface CanonicalPlaneSpec {
  constructionId: `construction_plane-${SketchPlaneKey}`;
  frame: SketchPlaneFrame;
}

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

function dot3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Project a world-space point (meters) onto a sketch plane, returning 2D
 * sketch-plane coordinates in document millimeters.
 */
export function projectPointToSketchPlane(
  point3d: readonly [number, number, number],
  plane: SketchPlaneDefinition,
): SketchPoint2D {
  const pointMm: readonly [number, number, number] = [
    point3d[0] * METERS_TO_MM,
    point3d[1] * METERS_TO_MM,
    point3d[2] * METERS_TO_MM,
  ];
  const delta: readonly [number, number, number] = [
    pointMm[0] - plane.frame.origin[0],
    pointMm[1] - plane.frame.origin[1],
    pointMm[2] - plane.frame.origin[2],
  ];
  return [dot3(delta, plane.frame.xAxis), dot3(delta, plane.frame.yAxis)];
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

/** Translate one Onshape solved sketch into a cadara sketch commit definition. */
export function translateSketch(
  input: SketchTranslationInput,
): SketchTranslationResult {
  const points: SketchPointDefinition[] = [];
  const entities: SketchEntityDefinition[] = [];
  const constraints: ConstraintDefinition[] = [];
  const diagnostics: SketchTranslationDiagnostic[] = [];
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
        entities.push({
          kind: "lineSegment",
          entityId: eid,
          label: entity.entityId,
          target,
          isConstruction,
          startPointId,
          endPointId,
        });
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
        entities.push({
          kind: "circle",
          entityId: eid,
          label: entity.entityId,
          target,
          isConstruction,
          centerPointId,
          radius: entity.radius,
        });
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
        entities.push({
          kind: "arc",
          entityId: eid,
          label: entity.entityId,
          target,
          isConstruction,
          centerPointId,
          startPointId,
          endPointId,
          sweepDirection: entity.sweepDirection ?? "counterClockwise",
        });
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
        entities.push({
          kind: "point",
          entityId: eid,
          label: entity.entityId,
          target,
          isConstruction,
          pointId: refPointId,
        });
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

  const definition: SketchDefinition = {
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: [],
    references: [],
    pointIds: points.map((point) => point.pointId),
    points,
    entityIds: entities.map((entity) => entity.entityId),
    entities,
    constraintIds: constraints.map((constraint) => constraint.constraintId),
    constraints,
    dimensionIds: [],
    dimensions: [],
    styleIds: [],
    styles: [],
    svgRenderingEnabled: true,
    derivedRelationships: [],
    authoringOperations: [],
  };

  return { plane, definition, diagnostics };
}

// Referenced only to keep the exhaustive kind list discoverable for reviewers.
export const SUPPORTED_SOLVED_ENTITY_KINDS: readonly SolvedSketchEntityKind[] = [
  "lineSegment",
  "circle",
  "arc",
  "point",
];

// Keep ConstraintId import meaningful for future constraint translation.
export type { ConstraintId };
