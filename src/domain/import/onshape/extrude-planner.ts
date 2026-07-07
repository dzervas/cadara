/**
 * Extrude translation + review-time region verification (tasks 3.1–3.4).
 *
 * Turns an Onshape `extrude` feature into a cadara parametric plan when its
 * profile regions can be verified at review time, or an honest baked reason code
 * when they cannot:
 *
 * - 3.1 Extent/operation translation: BLIND/SYMMETRIC/THROUGH_ALL extents,
 *   NEW/ADD/REMOVE/INTERSECT operations, expression-backed depths.
 * - 3.2 Interior-point derivation: region-face tessellation samples first,
 *   falling back to a point computed from the translated 2D rings.
 * - 3.3 Selector verification through the pure region-extraction contract over
 *   the translated solved sketch (no kernel, no mutation).
 * - 3.4 Narrow boolean-scope mapping: NEW → standalone; default-scope with a
 *   single upstream body → deferred `bodyOf`; otherwise probe-gated.
 *
 * The planner emits semantic references (owning sketch feature id, upstream
 * body-producing feature id). The provider maps those to ordered-action indices
 * when it emits deferred references.
 */
import type {
  ExtrudeFeatureExtent,
  FeatureBooleanOperation,
} from "@/contracts/modeling/schema";
import type { AuthoredValue } from "@/contracts/modeling/authored-values";
import type { DocumentId, RevisionId, SketchId } from "@/contracts/shared/ids";
import type { SketchPlaneKey } from "@/contracts/shared/sketch-plane";
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  type RegionRecord,
  type SketchDefinition,
  type SketchPoint2D,
  type SolvedSketchEntityGeometryRecord,
  type SolvedSketchPointRecord,
  type SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { deriveSketchRegionsCore } from "@/contracts/sketch/region-extraction";

import {
  selectInnermostContainingRegion,
  type RegionSelectionSketch,
} from "@/domain/import/region-containment";
import type {
  OnshapeFeatureNode,
  OnshapeSolvedSketch,
} from "@/domain/import/onshape/bundle-reader";
import { translateSolvedSketch } from "@/domain/import/onshape/solved-sketch-projection";
import { translateOnshapeExpression } from "@/domain/import/onshape/expression-translator";

export interface PlannedExtrudeProfile {
  /** Sketch-plane interior point that selects exactly one region at apply time. */
  interiorPoint: SketchPoint2D;
}

export type PlannedExtrudeBoolean =
  | { kind: "standalone" }
  | { kind: "deferredBody"; sourceFeatureId: string };

export interface PlannedExtrude {
  /** Onshape feature id of the sketch whose regions this extrude consumes. */
  sketchFeatureId: string;
  /** One deferred profile per consumed solid region. */
  profiles: PlannedExtrudeProfile[];
  extent: ExtrudeFeatureExtent;
  operation: AuthoredValue<FeatureBooleanOperation>;
  boolean: PlannedExtrudeBoolean;
}

export interface ExtrudePlanDiagnostic {
  code: string;
  message: string;
}

export type ExtrudePlanResult =
  | { tier: "parametric"; plannedExtrude: PlannedExtrude; diagnostics: ExtrudePlanDiagnostic[] }
  | {
      tier: "baked";
      reason:
        | "needs-region-resolution"
        | "needs-history-probe"
        | "unsupported-feature";
      diagnostics: ExtrudePlanDiagnostic[];
    };

export interface ExtrudePlanInput {
  feature: OnshapeFeatureNode;
  /** Solved sketch keyed by the extrude's referenced sketch feature id. */
  solvedSketch: OnshapeSolvedSketch | undefined;
  /** Plane and tier of the referenced sketch, as planned earlier in history. */
  referencedSketch: { tier: string; planeKey: SketchPlaneKey } | undefined;
  /** Onshape feature ids of prior parametric NEW-body extrudes, in order. */
  priorBodyProducingFeatureIds: readonly string[];
}

// ---- Onshape parameter reading (defensive) --------------------------------

function findParameter(
  feature: OnshapeFeatureNode,
  parameterId: string,
): Record<string, unknown> | null {
  for (const parameter of feature.parameters ?? []) {
    if (
      typeof parameter === "object" &&
      parameter !== null &&
      (parameter as { parameterId?: unknown }).parameterId === parameterId
    ) {
      return parameter as Record<string, unknown>;
    }
  }
  return null;
}

function enumValue(feature: OnshapeFeatureNode, parameterId: string): string | null {
  const parameter = findParameter(feature, parameterId);
  const value = parameter?.value;
  return typeof value === "string" ? value : null;
}

function booleanValue(feature: OnshapeFeatureNode, parameterId: string): boolean {
  return findParameter(feature, parameterId)?.value === true;
}

function quantityExpression(
  feature: OnshapeFeatureNode,
  parameterId: string,
): string | null {
  const parameter = findParameter(feature, parameterId);
  const expression = parameter?.expression;
  return typeof expression === "string" ? expression : null;
}

function hasQueries(feature: OnshapeFeatureNode, parameterId: string): boolean {
  const parameter = findParameter(feature, parameterId);
  const queries = parameter?.queries;
  return Array.isArray(queries) && queries.length > 0;
}

const SKETCH_REGION_REFERENCE =
  /q(?:SketchRegion|CreatedBy)\([^"]*"([A-Za-z0-9_]+)"/g;

/** Parse the distinct sketch feature ids referenced by the extrude `entities`. */
export function referencedSketchFeatureIds(feature: OnshapeFeatureNode): string[] {
  const parameter = findParameter(feature, "entities");
  const queries = parameter?.queries;
  if (!Array.isArray(queries)) {
    return [];
  }
  const ids = new Set<string>();
  for (const query of queries) {
    const queryString = (query as { queryString?: unknown }).queryString;
    if (typeof queryString !== "string") {
      continue;
    }
    for (const match of queryString.matchAll(SKETCH_REGION_REFERENCE)) {
      if (match[1]) {
        ids.add(match[1]);
      }
    }
  }
  return [...ids];
}

const BARE_NUMBER = /^-?\d+(?:\.\d+)?$/;

function authoredDistance(
  expression: string | null,
  diagnostics: ExtrudePlanDiagnostic[],
): AuthoredValue<number> {
  const translated = translateOnshapeExpression({ expression });
  if (translated.diagnostic) {
    diagnostics.push({
      code: translated.diagnostic.code,
      message: translated.diagnostic.message,
    });
  }
  if (BARE_NUMBER.test(translated.valueText)) {
    // Extrude distances are strictly positive; direction is carried separately.
    return { source: "literal", value: Math.abs(Number(translated.valueText)) };
  }
  return { source: "expression", valueText: translated.valueText };
}

function translateExtent(
  feature: OnshapeFeatureNode,
  diagnostics: ExtrudePlanDiagnostic[],
): ExtrudeFeatureExtent | null {
  const endBound = enumValue(feature, "endBound") ?? "BLIND";
  const direction = booleanValue(feature, "oppositeDirection")
    ? "negative"
    : "positive";
  const draftAngle = undefined;

  switch (endBound) {
    case "BLIND": {
      return {
        mode: "oneSide",
        end: {
          kind: "blind",
          direction,
          distance: authoredDistance(
            quantityExpression(feature, "depth"),
            diagnostics,
          ),
          draftAngle,
        },
      };
    }
    case "SYMMETRIC": {
      return {
        mode: "symmetric",
        end: {
          kind: "blind",
          direction,
          distance: authoredDistance(
            quantityExpression(feature, "depth"),
            diagnostics,
          ),
          draftAngle,
        },
      };
    }
    case "THROUGH_ALL": {
      return {
        mode: "oneSide",
        end: { kind: "throughAll", direction, draftAngle },
      };
    }
    default:
      // UP_TO_* extents reference downstream topology; probe-gated in v1.
      return null;
  }
}

const OPERATION_MAP: Record<string, FeatureBooleanOperation> = {
  NEW: "newBody",
  ADD: "join",
  REMOVE: "cut",
  INTERSECT: "intersect",
};

// ---- Region verification (task 3.3) ---------------------------------------

function buildSolvedSnapshot(definition: SketchDefinition): SolvedSketchSnapshot {
  const positionByPointId = new Map(
    definition.points.map((point) => [point.pointId, point.position] as const),
  );
  const solvedEntities: SolvedSketchEntityGeometryRecord[] = [];
  for (const entity of definition.entities) {
    if (entity.kind === "lineSegment") {
      const start = positionByPointId.get(entity.startPointId);
      const end = positionByPointId.get(entity.endPointId);
      if (start && end) {
        solvedEntities.push({
          entityId: entity.entityId,
          kind: "lineSegment",
          startPosition: start,
          endPosition: end,
        });
      }
    } else if (entity.kind === "circle") {
      const center = positionByPointId.get(entity.centerPointId);
      if (center) {
        solvedEntities.push({
          entityId: entity.entityId,
          kind: "circle",
          centerPosition: center,
          solvedRadius: entity.radius,
        });
      }
    } else if (entity.kind === "arc") {
      const center = positionByPointId.get(entity.centerPointId);
      const start = positionByPointId.get(entity.startPointId);
      const end = positionByPointId.get(entity.endPointId);
      if (center && start && end) {
        solvedEntities.push({
          entityId: entity.entityId,
          kind: "arc",
          centerPosition: center,
          startPosition: start,
          endPosition: end,
          sweepDirection: entity.sweepDirection,
        });
      }
    } else if (entity.kind === "point") {
      const position = positionByPointId.get(entity.pointId);
      if (position) {
        solvedEntities.push({
          entityId: entity.entityId,
          kind: "point",
          solvedPosition: position,
        });
      }
    }
  }

  const solvedPoints: SolvedSketchPointRecord[] = definition.points.map(
    (point) => ({
      pointId: point.pointId,
      target: point.target,
      solvedPosition: point.position,
    }),
  );

  return {
    schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
    status: { solveState: "solved", constraintState: "wellConstrained" },
    solvedEntities,
    solvedPoints,
    constraintStatuses: [],
    dimensionStatuses: [],
    diagnostics: [],
  };
}

const VERIFICATION_SKETCH_ID = "sketch_import_verification" as SketchId;

/** Compute a robust interior point for a region from its translated 2D rings. */
function interiorPointFromRing(
  sketch: RegionSelectionSketch,
  region: RegionRecord,
): SketchPoint2D | null {
  const outerLoop = region.loops.find((loop) => loop.role === "outer");
  if (!outerLoop) {
    return null;
  }
  const polygon = outerLoop.boundaryPointIds.flatMap((pointId) => {
    const position = sketch.solvedPoints.get(pointId);
    return position ? [position] : [];
  });

  if (polygon.length < 3) {
    // Circle-only region: the center is guaranteed interior.
    const segment = outerLoop.segments[0]?.source;
    if (segment && segment.kind === "entity") {
      const entity = sketch.definition.entities.find(
        (candidate) => candidate.entityId === segment.entityId,
      );
      if (entity && entity.kind === "circle") {
        const center = sketch.solvedPoints.get(entity.centerPointId);
        if (center && selectInnermostContainingRegion(sketch, center) === region) {
          return center;
        }
      }
    }
    return null;
  }

  const centroid: SketchPoint2D = [
    polygon.reduce((total, point) => total + point[0], 0) / polygon.length,
    polygon.reduce((total, point) => total + point[1], 0) / polygon.length,
  ];
  if (selectInnermostContainingRegion(sketch, centroid) === region) {
    return centroid;
  }

  // Concave outer loop: probe triangle-fan centroids until one lands inside.
  for (let i = 1; i < polygon.length - 1; i += 1) {
    const candidate: SketchPoint2D = [
      (polygon[0]![0] + polygon[i]![0] + polygon[i + 1]![0]) / 3,
      (polygon[0]![1] + polygon[i]![1] + polygon[i + 1]![1]) / 3,
    ];
    if (selectInnermostContainingRegion(sketch, candidate) === region) {
      return candidate;
    }
  }
  return null;
}

// ---- Top-level planning ----------------------------------------------------

export function planExtrudeFeature(input: ExtrudePlanInput): ExtrudePlanResult {
  const diagnostics: ExtrudePlanDiagnostic[] = [];
  const { feature } = input;

  const sketchIds = referencedSketchFeatureIds(feature);
  if (sketchIds.length !== 1) {
    // Zero or multiple owning sketches: not a single-sketch region consumer
    // this v1 can verify; leave it to the region-resolution reason.
    return { tier: "baked", reason: "needs-region-resolution", diagnostics };
  }
  const sketchFeatureId = sketchIds[0]!;

  if (
    !input.referencedSketch ||
    input.referencedSketch.tier !== "parametric" ||
    !input.solvedSketch
  ) {
    return { tier: "baked", reason: "needs-region-resolution", diagnostics };
  }

  const extent = translateExtent(feature, diagnostics);
  if (!extent) {
    return { tier: "baked", reason: "unsupported-feature", diagnostics };
  }

  // Translate the referenced sketch and extract its regions the same way
  // interactive authoring does, over the translated solved geometry.
  const translation = translateSolvedSketch({
    solved: input.solvedSketch,
    featureId: sketchFeatureId,
    label: sketchFeatureId,
    planeKey: input.referencedSketch.planeKey,
  });
  const { regions } = deriveSketchRegionsCore({
    documentId: "doc_import_verification" as DocumentId,
    revisionId: "rev_import_verification" as RevisionId,
    sketchId: VERIFICATION_SKETCH_ID,
    solvedSnapshot: buildSolvedSnapshot(translation.definition),
    definition: translation.definition,
  });
  const solidRegions = regions.filter((region) => region.isClosed);
  if (solidRegions.length === 0) {
    return { tier: "baked", reason: "needs-region-resolution", diagnostics };
  }

  const selectionSketch: RegionSelectionSketch = {
    regions: solidRegions,
    solvedPoints: new Map(
      buildSolvedSnapshot(translation.definition).solvedPoints.map(
        (point) => [point.pointId, point.solvedPosition] as const,
      ),
    ),
    definition: translation.definition,
  };

  const profiles: PlannedExtrudeProfile[] = [];
  for (const region of solidRegions) {
    const interiorPoint = interiorPointFromRing(selectionSketch, region);
    if (
      !interiorPoint ||
      selectInnermostContainingRegion(selectionSketch, interiorPoint) !== region
    ) {
      diagnostics.push({
        code: "onshape-region-selector-unverified",
        message: `An interior-point selector for extrude "${feature.name ?? feature.featureId}" could not be verified against region ${region.regionId}.`,
      });
      return { tier: "baked", reason: "needs-region-resolution", diagnostics };
    }
    profiles.push({ interiorPoint });
  }

  // Boolean scope mapping (task 3.4).
  const operationType = enumValue(feature, "operationType") ?? "NEW";
  const operation = OPERATION_MAP[operationType];
  if (!operation) {
    return { tier: "baked", reason: "unsupported-feature", diagnostics };
  }

  let boolean: PlannedExtrudeBoolean;
  if (operation === "newBody") {
    boolean = { kind: "standalone" };
  } else if (hasQueries(feature, "booleanScope")) {
    // Explicit Onshape scope queries need the sandboxed history probe.
    return { tier: "baked", reason: "needs-history-probe", diagnostics };
  } else if (input.priorBodyProducingFeatureIds.length === 1) {
    boolean = {
      kind: "deferredBody",
      sourceFeatureId: input.priorBodyProducingFeatureIds[0]!,
    };
  } else {
    // Zero or multiple upstream bodies: lineage is ambiguous; probe-gated.
    return { tier: "baked", reason: "needs-history-probe", diagnostics };
  }

  return {
    tier: "parametric",
    plannedExtrude: {
      sketchFeatureId,
      profiles,
      extent,
      operation: { source: "literal", value: operation },
      boolean,
    },
    diagnostics,
  };
}
