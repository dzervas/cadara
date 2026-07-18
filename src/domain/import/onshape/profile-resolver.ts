import type { DocumentId, RevisionId, SketchId } from "@/contracts/shared/ids";
import type { SketchPlaneFrame, SketchPlaneKey } from "@/contracts/shared/sketch-plane";
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
import type { OnshapeSolvedSketch } from "@/domain/import/onshape/bundle-reader";
import { translateSolvedSketch } from "@/domain/import/onshape/solved-sketch-projection";

export interface DeferredSketchProfile {
  /** Sketch-plane interior point that selects exactly one region at apply time. */
  interiorPoint: SketchPoint2D;
}

export interface ProfileResolutionDiagnostic {
  code: string;
  message: string;
}

export type ProfileResolutionResult =
  | {
      tier: "resolved";
      sketchFeatureId: string;
      profiles: DeferredSketchProfile[];
      diagnostics: ProfileResolutionDiagnostic[];
    }
  | {
      tier: "unresolved";
      reason: "needs-region-resolution";
      diagnostics: ProfileResolutionDiagnostic[];
    };

export interface ProfileResolutionInput {
  /** The feature parameter carrying Onshape sketch-region queries (usually `entities`). */
  profileParameter: unknown;
  /** Used only in a diagnostic when a selector cannot be verified. */
  featureLabel: string;
  /** Feature-kind label used only in selector verification diagnostics. */
  featureKind: string;
  /** Solved sketch keyed by the referenced sketch feature id. */
  solvedSketch: OnshapeSolvedSketch | undefined;
  /** Plane and tier of the referenced sketch, as planned earlier in history. */
  referencedSketch: { tier: string; planeKey: SketchPlaneKey; planeFrame?: SketchPlaneFrame } | undefined;
}

const SKETCH_REGION_REFERENCE =
  /q(?:SketchRegion|CreatedBy)\([^"]*"([A-Za-z0-9_]+)"/g;

/** Parse the distinct sketch feature ids referenced by an Onshape profile parameter. */
export function referencedSketchFeatureIdsFromProfileParameter(profileParameter: unknown): string[] {
  if (typeof profileParameter !== "object" || profileParameter === null) {
    return [];
  }
  const queries = (profileParameter as { queries?: unknown }).queries;
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

  const solvedPoints: SolvedSketchPointRecord[] = definition.points.map((point) => ({
    pointId: point.pointId,
    target: point.target,
    solvedPosition: point.position,
  }));

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

/**
 * Resolve an Onshape sketch-region parameter to deferred profiles after proving
 * every selector against the translated sketch's extracted regions.
 */
export function resolveOnshapeSketchProfiles(
  input: ProfileResolutionInput,
): ProfileResolutionResult {
  const diagnostics: ProfileResolutionDiagnostic[] = [];
  const sketchIds = referencedSketchFeatureIdsFromProfileParameter(input.profileParameter);
  if (
    sketchIds.length !== 1 ||
    !input.referencedSketch ||
    input.referencedSketch.tier !== "parametric" ||
    !input.solvedSketch
  ) {
    return { tier: "unresolved", reason: "needs-region-resolution", diagnostics };
  }
  const sketchFeatureId = sketchIds[0]!;
  const translation = translateSolvedSketch({
    solved: input.solvedSketch,
    featureId: sketchFeatureId,
    label: sketchFeatureId,
    planeKey: input.referencedSketch.planeKey,
    planeFrame: input.referencedSketch.planeFrame,
  });
  const solvedSnapshot = buildSolvedSnapshot(translation.definition);
  const { regions } = deriveSketchRegionsCore({
    documentId: "doc_import_verification" as DocumentId,
    revisionId: "rev_import_verification" as RevisionId,
    sketchId: VERIFICATION_SKETCH_ID,
    solvedSnapshot,
    definition: translation.definition,
  });
  const solidRegions = regions.filter((region) => region.isClosed);
  if (solidRegions.length === 0) {
    return { tier: "unresolved", reason: "needs-region-resolution", diagnostics };
  }

  const selectionSketch: RegionSelectionSketch = {
    regions: solidRegions,
    solvedPoints: new Map(
      solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition] as const),
    ),
    definition: translation.definition,
  };
  const profiles: DeferredSketchProfile[] = [];
  for (const region of solidRegions) {
    const interiorPoint = interiorPointFromRing(selectionSketch, region);
    if (
      !interiorPoint ||
      selectInnermostContainingRegion(selectionSketch, interiorPoint) !== region
    ) {
      diagnostics.push({
        code: "onshape-region-selector-unverified",
        message: `An interior-point selector for ${input.featureKind} "${input.featureLabel}" could not be verified against region ${region.regionId}.`,
      });
      return { tier: "unresolved", reason: "needs-region-resolution", diagnostics };
    }
    profiles.push({ interiorPoint });
  }

  return { tier: "resolved", sketchFeatureId, profiles, diagnostics };
}
