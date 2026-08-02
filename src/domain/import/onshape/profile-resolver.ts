import type { ImportDeferredTopologyRef } from "@/contracts/import/actions";
import {
  deriveImportRegionBoundaryIdentity,
  type ImportRegionBoundaryIdentity,
} from "@/contracts/import/region-boundary-identity";
import type { OnshapeProfileEvidence } from "@/contracts/import/onshape-capture-bundle";
import type { DocumentId, RevisionId, SketchEntityId, SketchId } from "@/contracts/shared/ids";
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
import { REGION_POINT_TOLERANCE } from "@/contracts/sketch/region-geometry";
import {
  countContainingRegions,
  selectInnermostContainingRegion,
  type RegionSelectionSketch,
} from "@/domain/import/region-containment";
import type { OnshapeSolvedSketch } from "@/domain/import/onshape/bundle-reader";
import { DEFAULT_MATCH_TOLERANCE } from "@/domain/import/onshape/signature-matcher";
import { readSketchEntityEdgeQuery } from "@/domain/import/onshape/sketch-point-query-reader";
import { projectPointToPlane, projectPointToSketchPlaneFrame } from "@/domain/import/onshape/sketch-translator";
import { translateSolvedSketch } from "@/domain/import/onshape/solved-sketch-projection";

export interface ExactProfileEvidenceIdentity {
  consumerFeatureId: string;
  queryIndex: number;
  resultIndex: number;
  deterministicId: string;
}

export type DeferredSketchProfile = {
  kind: "sketchRegion";
  /** Sketch feature owning the exact captured qSketchRegion result. */
  sketchFeatureId: string;
  /** Import-only boundary provenance derived while verifying the captured selection. */
  boundaryIdentity: ImportRegionBoundaryIdentity;
  /** Sketch-plane witness retained for diagnostics and legacy compatibility. */
  interiorPoint: SketchPoint2D;
  evidence?: ExactProfileEvidenceIdentity;
};

export type DeferredPlanarFaceProfile = {
  kind: "planarFace";
  /** Exact selected planar face, rematched only immediately before apply. */
  selector: ImportDeferredTopologyRef;
  evidence?: ExactProfileEvidenceIdentity;
};

export type DeferredOnshapeProfile = DeferredSketchProfile | DeferredPlanarFaceProfile;

/**
 * Exact open sketch curve consumed as a surface profile seed. One ref names one
 * durable translated sketch entity; the kernel groups connected refs into a wire.
 */
export type DeferredOpenSketchCurveProfile = {
  kind: "sketchCurve";
  sketchFeatureId: string;
  entityId: SketchEntityId;
};

export interface ProfileResolutionDiagnostic {
  code: string;
  message: string;
}

export type ProfileResolutionResult =
  | {
      tier: "resolved";
      profiles: DeferredOnshapeProfile[];
      diagnostics: ProfileResolutionDiagnostic[];
    }
  | {
      tier: "unresolved";
      reason: "needs-region-resolution";
      diagnostics: ProfileResolutionDiagnostic[];
    };

export interface ProfileResolutionInput {
  /** The feature parameter carrying Onshape sketch-region or face queries. */
  profileParameter: unknown;
  /** Onshape extrude that owns this profile parameter. */
  consumerFeatureId: string;
  /** Used only in a diagnostic when a selector cannot be verified. */
  featureLabel: string;
  /** Feature-kind label used only in selector verification diagnostics. */
  featureKind: string;
  /** Exact capture records for this consumer's entities parameter. */
  profileEvidence: readonly OnshapeProfileEvidence[];
  /** Solved sketches keyed by exact captured source sketch feature id. */
  solvedSketchesByFeatureId: ReadonlyMap<string, OnshapeSolvedSketch>;
  /** Earlier planned sketches keyed by exact captured source sketch feature id. */
  referencedSketchesByFeatureId: ReadonlyMap<
    string,
    { tier: string; planeKey: SketchPlaneKey; planeFrame?: SketchPlaneFrame }
  >;
}

const SKETCH_REGION_REFERENCE =
  /q(?:SketchRegion|CreatedBy)\([^"]*"([A-Za-z0-9_]+)"/g;

/** Parse readable source ids only; compressed queries remain opaque. */
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
    if (typeof queryString !== "string") continue;
    for (const match of queryString.matchAll(SKETCH_REGION_REFERENCE)) {
      if (match[1]) ids.add(match[1]);
    }
  }
  return [...ids];
}

function queryCount(profileParameter: unknown): number {
  if (!profileParameter || typeof profileParameter !== "object") return 0;
  const queries = (profileParameter as { queries?: unknown }).queries;
  return Array.isArray(queries) ? queries.length : 0;
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

function* legacyInteriorPoint(selectionSketch: RegionSelectionSketch) {
  for (const region of selectionSketch.regions) {
    const outer = region.loops.find((loop) => loop.role === "outer");
    if (!outer) continue;
    const points = outer.boundaryPointIds.flatMap((id) => {
      const point = selectionSketch.solvedPoints.get(id);
      return point ? [point] : [];
    });
    if (points.length >= 3) {
      const point: SketchPoint2D = [
        points.reduce((sum, candidate) => sum + candidate[0], 0) / points.length,
        points.reduce((sum, candidate) => sum + candidate[1], 0) / points.length,
      ];
      if (countContainingRegions(selectionSketch, point) === 1) {
        yield { region, interiorPoint: point };
      }
      continue;
    }
    const source = outer.segments[0]?.source;
    const entity = source?.kind === "entity"
      ? selectionSketch.definition.entities.find((candidate) => candidate.entityId === source.entityId)
      : undefined;
    if (entity?.kind === "circle") {
      const point = selectionSketch.solvedPoints.get(entity.centerPointId);
      if (point && countContainingRegions(selectionSketch, point) === 1) {
        yield { region, interiorPoint: point };
      }
    }
  }
}

function resolveLegacyNonExtrudeProfiles(
  input: ProfileResolutionInput,
): ProfileResolutionResult {
  const sketchIds = referencedSketchFeatureIdsFromProfileParameter(input.profileParameter);
  if (sketchIds.length !== 1) {
    return { tier: "unresolved", reason: "needs-region-resolution", diagnostics: [] };
  }
  const sketchFeatureId = sketchIds[0]!;
  const solved = input.solvedSketchesByFeatureId.get(sketchFeatureId);
  const referencedSketch = input.referencedSketchesByFeatureId.get(sketchFeatureId);
  if (!solved || !referencedSketch || referencedSketch.tier !== "parametric") {
    return { tier: "unresolved", reason: "needs-region-resolution", diagnostics: [] };
  }
  const translation = translateSolvedSketch({
    solved,
    featureId: sketchFeatureId,
    label: sketchFeatureId,
    planeKey: referencedSketch.planeKey,
    planeFrame: referencedSketch.planeFrame,
  });
  const solvedSnapshot = buildSolvedSnapshot(translation.definition);
  const { regions } = deriveSketchRegionsCore({
    documentId: "doc_import_verification" as DocumentId,
    revisionId: "rev_import_verification" as RevisionId,
    sketchId: VERIFICATION_SKETCH_ID,
    solvedSnapshot,
    definition: translation.definition,
  });
  const selectionSketch: RegionSelectionSketch = {
    regions: regions.filter((region) => region.isClosed),
    solvedPoints: new Map(
      solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition] as const),
    ),
    definition: translation.definition,
  };
  const profiles = [...legacyInteriorPoint(selectionSketch)].map(({ region, interiorPoint }) => ({
    kind: "sketchRegion" as const,
    sketchFeatureId,
    boundaryIdentity: deriveImportRegionBoundaryIdentity(region, regions),
    interiorPoint,
  }));
  return profiles.length > 0
    ? { tier: "resolved", profiles, diagnostics: [] }
    : { tier: "unresolved", reason: "needs-region-resolution", diagnostics: [] };
}

function loopIdentity(loop: RegionRecord["loops"][number]): string {
  return JSON.stringify(loop.segments.map((segment) => segment.source));
}

/**
 * qSketchRegion(..., true) filters nested region faces. A derived region is a
 * root exactly when its outer loop is not an inner loop of another derived
 * region. This uses region topology only; it never compares geometry.
 */
function filteredSketchRegions(regions: readonly RegionRecord[]): RegionRecord[] {
  const innerLoopIdentities = new Set(
    regions.flatMap((region) => region.loops.filter((loop) => loop.role === "inner").map(loopIdentity)),
  );
  return regions.filter((region) => {
    const outer = region.loops.find((loop) => loop.role === "outer");
    return outer !== undefined && !innerLoopIdentities.has(loopIdentity(outer));
  });
}

function circleLoopGeometry(
  sketch: RegionSelectionSketch,
  loop: RegionRecord["loops"][number],
): { center: SketchPoint2D; radius: number } | null {
  if (loop.segments.length !== 1) return null;
  const source = loop.segments[0]?.source;
  if (source?.kind !== "entity") return null;
  const entity = sketch.definition.entities.find(
    (candidate) => candidate.entityId === source.entityId,
  );
  if (entity?.kind !== "circle") return null;
  const center = sketch.solvedPoints.get(entity.centerPointId);
  return center ? { center: [center[0], center[1]], radius: entity.radius } : null;
}

function concentricAnnulusCandidates(
  sketch: RegionSelectionSketch,
  region: RegionRecord,
): SketchPoint2D[] {
  const outerLoop = region.loops.find((loop) => loop.role === "outer");
  const innerLoops = region.loops.filter((loop) => loop.role === "inner");
  if (!outerLoop || innerLoops.length !== 1) return [];
  const outer = circleLoopGeometry(sketch, outerLoop);
  const inner = circleLoopGeometry(sketch, innerLoops[0]!);
  if (
    !outer ||
    !inner ||
    Math.hypot(
      outer.center[0] - inner.center[0],
      outer.center[1] - inner.center[1],
    ) > REGION_POINT_TOLERANCE ||
    outer.radius - inner.radius <= REGION_POINT_TOLERANCE
  ) return [];
  const radius = (outer.radius + inner.radius) / 2;
  return ([[1, 0], [0, 1], [-1, 0], [0, -1]] as const).map(
    ([x, y]) => [outer.center[0] + radius * x, outer.center[1] + radius * y],
  );
}

function verifiedRegionSelector(
  sketch: RegionSelectionSketch,
  region: RegionRecord,
): SketchPoint2D | null {
  const candidates = new Map<string, SketchPoint2D>();
  const add = (point: SketchPoint2D) => {
    const key = `${point[0]},${point[1]}`;
    candidates.set(key, point);
  };
  for (const point of concentricAnnulusCandidates(sketch, region)) add(point);
  const points = [...sketch.solvedPoints.values()];
  for (const point of points) add([point[0], point[1]]);
  for (const entity of sketch.definition.entities) {
    if (entity.kind !== "circle") continue;
    const center = sketch.solvedPoints.get(entity.centerPointId);
    if (!center) continue;
    add([center[0], center[1]]);
    for (const direction of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      add([center[0] + entity.radius * direction[0] * 0.5, center[1] + entity.radius * direction[1] * 0.5]);
    }
  }
  const bounds = [...points];
  for (const entity of sketch.definition.entities) {
    if (entity.kind !== "circle") continue;
    const center = sketch.solvedPoints.get(entity.centerPointId);
    if (!center) continue;
    bounds.push(
      [center[0] - entity.radius, center[1] - entity.radius],
      [center[0] + entity.radius, center[1] + entity.radius],
    );
  }
  if (bounds.length > 0) {
    const xs = bounds.map((point) => point[0]);
    const ys = bounds.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    for (const divisions of [3, 7, 15, 31]) {
      for (let row = 0; row < divisions; row += 1) {
        for (let column = 0; column < divisions; column += 1) {
          add([
            minX + ((column + 0.5) / divisions) * (maxX - minX),
            minY + ((row + 0.5) / divisions) * (maxY - minY),
          ]);
        }
      }
    }
  }
  for (const candidate of candidates.values()) {
    if (
      countContainingRegions(sketch, candidate) === 1 &&
      selectInnermostContainingRegion(sketch, candidate)?.regionId === region.regionId
    ) return candidate;
  }
  return null;
}

function resolveSketchRegionSet(input: {
  evidence: Extract<OnshapeProfileEvidence, { kind: "sketchRegionSet" }>;
  resolution: ProfileResolutionInput;
  diagnostics: ProfileResolutionDiagnostic[];
}): DeferredSketchProfile[] | null {
  const sketchFeatureId = input.evidence.sourceSketchFeatureId;
  const solved = input.resolution.solvedSketchesByFeatureId.get(sketchFeatureId);
  const referencedSketch = input.resolution.referencedSketchesByFeatureId.get(sketchFeatureId);
  if (!solved || !referencedSketch || referencedSketch.tier !== "parametric") {
    input.diagnostics.push({
      code: "onshape-region-source-sketch-unavailable",
      message: `The exact source sketch ${sketchFeatureId} is not a live solved sketch.`,
    });
    return null;
  }
  const translation = translateSolvedSketch({
    solved,
    featureId: sketchFeatureId,
    label: sketchFeatureId,
    planeKey: referencedSketch.planeKey,
    planeFrame: referencedSketch.planeFrame,
  });
  const solvedSnapshot = buildSolvedSnapshot(translation.definition);
  const { regions } = deriveSketchRegionsCore({
    documentId: "doc_import_verification" as DocumentId,
    revisionId: "rev_import_verification" as RevisionId,
    sketchId: VERIFICATION_SKETCH_ID,
    solvedSnapshot,
    definition: translation.definition,
  });
  const selectionSketch: RegionSelectionSketch = {
    regions: regions.filter((region) => region.isClosed),
    solvedPoints: new Map(
      solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition] as const),
    ),
    definition: translation.definition,
  };
  const hasInnerLoops = selectionSketch.regions.some((region) =>
    region.loops.some((loop) => loop.role === "inner"),
  );
  if (!input.evidence.filterInnerLoops && hasInnerLoops) {
    input.diagnostics.push({
      code: "onshape-region-set-inner-loops-unresolved",
      message: `The exact qSketchRegion(..., false) semantics for ${input.resolution.featureKind} "${input.resolution.featureLabel}" include inner loops that cannot be represented by local derived regions.`,
    });
    return null;
  }
  const targetRegions = input.evidence.filterInnerLoops
    ? filteredSketchRegions(selectionSketch.regions)
    : selectionSketch.regions;
  const selectors = targetRegions.map((region) => ({
    region,
    interiorPoint: verifiedRegionSelector(selectionSketch, region),
  }));
  if (
    targetRegions.length === 0 ||
    selectors.some((selector) => selector.interiorPoint === null)
  ) {
    input.diagnostics.push({
      code: "onshape-region-set-selector-unverified",
      message: `The exact qSketchRegion set for ${input.resolution.featureKind} "${input.resolution.featureLabel}" could not be expanded into one verified selector for every locally derived region.`,
    });
    return null;
  }
  return selectors.map(({ region, interiorPoint }) => ({
    kind: "sketchRegion",
    sketchFeatureId,
    boundaryIdentity: deriveImportRegionBoundaryIdentity(region, regions),
    interiorPoint: interiorPoint!,
  }));
}

function resolveSketchProfile(input: {
  evidence: Extract<OnshapeProfileEvidence, { kind: "sketchRegion" }>;
  resolution: ProfileResolutionInput;
  diagnostics: ProfileResolutionDiagnostic[];
}): DeferredSketchProfile | null {
  if ("unresolved" in input.evidence) {
    input.diagnostics.push({
      code: "onshape-region-witness-unresolved",
      message: `The exact sketch-region result ${input.evidence.deterministicId} for ${input.resolution.featureKind} "${input.resolution.featureLabel}" has no server-certified interior point: ${input.evidence.unresolved.reason}.`,
    });
    return null;
  }
  const sketchFeatureId = input.evidence.sourceSketchFeatureId;
  const solved = input.resolution.solvedSketchesByFeatureId.get(sketchFeatureId);
  const referencedSketch = input.resolution.referencedSketchesByFeatureId.get(sketchFeatureId);
  if (!solved || !referencedSketch || referencedSketch.tier !== "parametric") {
    input.diagnostics.push({
      code: "onshape-region-source-sketch-unavailable",
      message: `The exact source sketch ${sketchFeatureId} for profile ${input.evidence.deterministicId} is not a live solved sketch.`,
    });
    return null;
  }
  const translation = translateSolvedSketch({
    solved,
    featureId: sketchFeatureId,
    label: sketchFeatureId,
    planeKey: referencedSketch.planeKey,
    planeFrame: referencedSketch.planeFrame,
  });
  const solvedSnapshot = buildSolvedSnapshot(translation.definition);
  const { regions } = deriveSketchRegionsCore({
    documentId: "doc_import_verification" as DocumentId,
    revisionId: "rev_import_verification" as RevisionId,
    sketchId: VERIFICATION_SKETCH_ID,
    solvedSnapshot,
    definition: translation.definition,
  });
  const selectionSketch: RegionSelectionSketch = {
    regions: regions.filter((region) => region.isClosed),
    solvedPoints: new Map(
      solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition] as const),
    ),
    definition: translation.definition,
  };
  const interiorPoint = referencedSketch.planeFrame
    ? projectPointToSketchPlaneFrame(input.evidence.interiorPoint3d, referencedSketch.planeFrame)
    : projectPointToPlane(input.evidence.interiorPoint3d, referencedSketch.planeKey);
  const selected = selectInnermostContainingRegion(selectionSketch, interiorPoint);
  if (!selected || countContainingRegions(selectionSketch, interiorPoint) !== 1) {
    input.diagnostics.push({
      code: "onshape-region-selector-unverified",
      message: `The server-certified profile witness ${input.evidence.deterministicId} does not select one exact region for ${input.resolution.featureKind} "${input.resolution.featureLabel}".`,
    });
    return null;
  }
  return {
    kind: "sketchRegion",
    sketchFeatureId,
    boundaryIdentity: deriveImportRegionBoundaryIdentity(selected, regions),
    interiorPoint,
    evidence: {
      consumerFeatureId: input.evidence.consumingFeatureId,
      queryIndex: input.evidence.queryIndex,
      resultIndex: input.evidence.resultIndex,
      deterministicId: input.evidence.deterministicId,
    },
  };
}

/**
 * Resolve only the exact captured selected faces. This intentionally never
 * derives a selector from all closed regions, decodes qCompressed, or searches
 * for a geometrically nearby source.
 */
export function resolveOnshapeSketchProfiles(
  input: ProfileResolutionInput,
): ProfileResolutionResult {
  // X.4 changes solid-extrude profile selection only. Existing non-extrude
  // translators retain their independently scoped region behavior until their
  // capture contract gains equivalent consumer-indexed evidence.
  if (input.featureKind !== "extrude") return resolveLegacyNonExtrudeProfiles(input);
  const diagnostics: ProfileResolutionDiagnostic[] = [];
  const expectedQueries = queryCount(input.profileParameter);
  if (expectedQueries === 0) {
    return { tier: "unresolved", reason: "needs-region-resolution", diagnostics };
  }
  const evidence = input.profileEvidence.filter(
    (record) =>
      record.consumingFeatureId === input.consumerFeatureId &&
      record.parameterId === "entities" &&
      record.evaluatedAt === "historyPoint",
  );
  const profiles: DeferredOnshapeProfile[] = [];
  for (let queryIndex = 0; queryIndex < expectedQueries; queryIndex += 1) {
    const queryEvidence = evidence
      .filter((record) => record.queryIndex === queryIndex)
      .sort(
        (left, right) =>
          (("resultIndex" in left ? left.resultIndex : -1) ?? -1) -
          (("resultIndex" in right ? right.resultIndex : -1) ?? -1),
      );
    if (queryEvidence.length === 0 || queryEvidence.some((record) => record.kind === "unresolved")) {
      diagnostics.push({
        code: "onshape-profile-evidence-unresolved",
        message: `No complete exact evidence was captured for ${input.featureKind} "${input.featureLabel}" profile query ${queryIndex}.`,
      });
      return { tier: "unresolved", reason: "needs-region-resolution", diagnostics };
    }
    if (queryEvidence.length === 1 && queryEvidence[0]?.kind === "sketchRegionSet") {
      const regionSetProfiles = resolveSketchRegionSet({
        evidence: queryEvidence[0],
        resolution: input,
        diagnostics,
      });
      if (!regionSetProfiles) return { tier: "unresolved", reason: "needs-region-resolution", diagnostics };
      profiles.push(...regionSetProfiles);
      continue;
    }
    if (queryEvidence.some((record) => record.kind === "sketchRegionSet")) {
      diagnostics.push({
        code: "onshape-profile-evidence-order-invalid",
        message: `Exact qSketchRegion-set evidence for ${input.featureKind} "${input.featureLabel}" query ${queryIndex} is mixed with face-result evidence.`,
      });
      return { tier: "unresolved", reason: "needs-region-resolution", diagnostics };
    }
    const faceResultEvidence = queryEvidence.filter(
      (record): record is Exclude<OnshapeProfileEvidence, { kind: "sketchRegionSet" }> =>
        record.kind !== "sketchRegionSet",
    );
    if (faceResultEvidence.some((record, resultIndex) => record.resultIndex !== resultIndex)) {
      diagnostics.push({
        code: "onshape-profile-evidence-order-invalid",
        message: `Exact profile evidence for ${input.featureKind} "${input.featureLabel}" query ${queryIndex} has a missing or duplicate result index.`,
      });
      return { tier: "unresolved", reason: "needs-region-resolution", diagnostics };
    }
    for (const record of faceResultEvidence) {
      if (record.kind === "sketchRegion") {
        const profile = resolveSketchProfile({ evidence: record, resolution: input, diagnostics });
        if (!profile) return { tier: "unresolved", reason: "needs-region-resolution", diagnostics };
        profiles.push(profile);
        continue;
      }
      if (
        record.kind !== "planarFace" ||
        record.signature.entityClass !== "face" ||
        record.signature.geometryType.toLowerCase() !== "plane"
      ) {
        return { tier: "unresolved", reason: "needs-region-resolution", diagnostics };
      }
      profiles.push({
        kind: "planarFace",
        evidence: {
          consumerFeatureId: record.consumingFeatureId,
          queryIndex: record.queryIndex,
          resultIndex: record.resultIndex,
          deterministicId: record.deterministicId,
        },
        selector: {
          kind: "topologyOf",
          expectedKind: "face",
          capturedSignature: record.signature,
          tolerance: DEFAULT_MATCH_TOLERANCE,
          source: {
            consumerFeatureId: input.consumerFeatureId,
            parameterId: "entities",
            deterministicId: record.deterministicId,
          },
        },
      });
    }
  }
  return profiles.length > 0
    ? { tier: "resolved", profiles, diagnostics }
    : { tier: "unresolved", reason: "needs-region-resolution", diagnostics };
}

/**
 * Exact readable whole-sketch wire query: every non-construction edge created by
 * one sketch. Onshape authors this form when a surface extrude consumes a whole
 * open sketch.
 */
const WHOLE_SKETCH_WIRE_QUERY =
  /^\s*query\s*=\s*qConstructionFilter\(\s*qBodyType\(\s*qCreatedBy\(\s*id\s*\+\s*"([A-Za-z0-9_]+)"\s*,\s*EntityType\.EDGE\s*\)\s*,\s*BodyType\.WIRE\s*\)\s*,\s*ConstructionObject\.NO\s*\)\s*;?\s*$/;

type DecodedSurfaceProfileQuery =
  | { form: "entity"; sketchFeatureId: string; sketchEntityId: string }
  | { form: "wholeSketchWire"; sketchFeatureId: string };

function decodeSurfaceProfileQuery(
  queryString: unknown,
): DecodedSurfaceProfileQuery | null {
  if (typeof queryString !== "string") return null;
  const wholeSketch = WHOLE_SKETCH_WIRE_QUERY.exec(queryString);
  if (wholeSketch) {
    return { form: "wholeSketchWire", sketchFeatureId: wholeSketch[1]! };
  }
  const decoded = readSketchEntityEdgeQuery(queryString);
  return decoded
    ? {
        form: "entity",
        sketchFeatureId: decoded.sketchFeatureId,
        sketchEntityId: decoded.sketchEntityId,
      }
    : null;
}

function entityEndpoints(
  entity: SketchDefinition["entities"][number],
  definition: SketchDefinition,
): SketchPoint2D[] {
  const pointIds =
    entity.kind === "lineSegment" || entity.kind === "arc"
      ? [entity.startPointId, entity.endPointId]
      : [];
  return pointIds.flatMap((pointId) => {
    const point = definition.points.find((candidate) => candidate.pointId === pointId);
    return point ? [point.position] : [];
  });
}

function arePointsCoincident(left: SketchPoint2D, right: SketchPoint2D): boolean {
  return (
    Math.abs(left[0] - right[0]) <= REGION_POINT_TOLERANCE &&
    Math.abs(left[1] - right[1]) <= REGION_POINT_TOLERANCE
  );
}

/**
 * True when the selected entities form exactly one connected chain, using the
 * same endpoint-coincidence rules the adapter applies when it groups open curves
 * into one wire: no endpoint of degree above two, either zero or two free ends,
 * and one connected component. A set the adapter would reject is rejected here so
 * the whole import is not rolled back at apply time.
 */
function formsOneConnectedChain(
  entities: readonly SketchDefinition["entities"][number][],
  definition: SketchDefinition,
): boolean {
  if (entities.length === 0) return false;
  if (entities.length === 1) return true;
  // A closed curve cannot be chained with anything else.
  const endpointsByEntity = entities.map((entity) => entityEndpoints(entity, definition));
  if (endpointsByEntity.some((endpoints) => endpoints.length !== 2)) return false;

  const nodes: Array<{ position: SketchPoint2D; degree: number }> = [];
  const nodeIndexes = endpointsByEntity.map((endpoints) =>
    endpoints.map((position) => {
      const existing = nodes.findIndex((node) => arePointsCoincident(node.position, position));
      if (existing >= 0) {
        nodes[existing]!.degree += 1;
        return existing;
      }
      nodes.push({ position, degree: 1 });
      return nodes.length - 1;
    }),
  );
  if (nodes.some((node) => node.degree > 2)) return false;
  const freeEnds = nodes.filter((node) => node.degree === 1).length;
  if (freeEnds !== 0 && freeEnds !== 2) return false;

  const remaining = nodeIndexes.slice(1);
  const chain = new Set(nodeIndexes[0]!);
  let grew = true;
  while (grew) {
    grew = false;
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (remaining[index]!.some((node) => chain.has(node))) {
        for (const node of remaining[index]!) chain.add(node);
        remaining.splice(index, 1);
        grew = true;
      }
    }
  }
  return remaining.length === 0;
}

export type OpenSketchCurveResolutionResult =
  | {
      tier: "resolved";
      profiles: DeferredOpenSketchCurveProfile[];
      diagnostics: ProfileResolutionDiagnostic[];
    }
  | { tier: "unresolved"; diagnostics: ProfileResolutionDiagnostic[] };

/**
 * Resolve an Onshape surface extrude's `surfaceEntities` queries into durable
 * open sketch-curve profile seeds of the translated solved sketch.
 *
 * Only the two exactly readable Onshape forms are decoded: a compressed
 * `SKETCH_ENTITY` edge query naming one entity, and a readable whole-sketch wire
 * `qCreatedBy` query. Everything else — an opaque query, several source sketches,
 * an entity the translated sketch does not own, a whole-sketch reference over a
 * sketch that derives closed regions (whose `BodyType.WIRE` filtering is not
 * observable from the capture), or a set that is not one connected chain — stays
 * unresolved with a specific diagnostic instead of guessing a profile.
 */
export function resolveOnshapeOpenSketchCurveProfiles(input: {
  /** The Onshape `surfaceEntities` parameter carrying open-curve queries. */
  profileParameter: unknown;
  featureKind: string;
  featureLabel: string;
  solvedSketchesByFeatureId: ReadonlyMap<string, OnshapeSolvedSketch>;
  referencedSketchesByFeatureId: ReadonlyMap<
    string,
    { tier: string; planeKey: SketchPlaneKey; planeFrame?: SketchPlaneFrame }
  >;
}): OpenSketchCurveResolutionResult {
  const diagnostics: ProfileResolutionDiagnostic[] = [];
  const label = `${input.featureKind} "${input.featureLabel}"`;
  const unresolved = (code: string, message: string): OpenSketchCurveResolutionResult => {
    diagnostics.push({ code, message });
    return { tier: "unresolved", diagnostics };
  };

  const queries =
    typeof input.profileParameter === "object" && input.profileParameter !== null
      ? (input.profileParameter as { queries?: unknown }).queries
      : undefined;
  if (!Array.isArray(queries) || queries.length === 0) {
    return unresolved(
      "onshape-surface-profile-parameter-unreadable",
      `The surface profile parameter for ${label} carries no readable queries.`,
    );
  }

  const decoded = queries.map((query) =>
    decodeSurfaceProfileQuery(
      typeof query === "object" && query !== null
        ? (query as { queryString?: unknown }).queryString
        : null,
    ),
  );
  if (decoded.some((entry) => entry === null)) {
    return unresolved(
      "onshape-surface-profile-query-unreadable",
      `A surface profile query for ${label} is not an exact sketch-entity or whole-sketch wire query.`,
    );
  }
  const readable = decoded as DecodedSurfaceProfileQuery[];
  const sketchFeatureIds = new Set(readable.map((entry) => entry.sketchFeatureId));
  if (sketchFeatureIds.size !== 1) {
    return unresolved(
      "onshape-surface-profile-multi-sketch",
      `The surface profile queries for ${label} name ${sketchFeatureIds.size} source sketches; one connected chain must come from one sketch.`,
    );
  }
  const sketchFeatureId = [...sketchFeatureIds][0]!;

  const solved = input.solvedSketchesByFeatureId.get(sketchFeatureId);
  const referencedSketch = input.referencedSketchesByFeatureId.get(sketchFeatureId);
  if (!solved || !referencedSketch || referencedSketch.tier !== "parametric") {
    return unresolved(
      "onshape-surface-profile-source-sketch-unavailable",
      `The exact source sketch ${sketchFeatureId} for ${label} is not a live solved sketch.`,
    );
  }
  const translation = translateSolvedSketch({
    solved,
    featureId: sketchFeatureId,
    label: sketchFeatureId,
    planeKey: referencedSketch.planeKey,
    planeFrame: referencedSketch.planeFrame,
  });

  const selected: SketchDefinition["entities"][number][] = [];
  for (const entry of readable) {
    if (entry.form === "wholeSketchWire") {
      const solvedSnapshot = buildSolvedSnapshot(translation.definition);
      const { regions } = deriveSketchRegionsCore({
        documentId: "doc_import_verification" as DocumentId,
        revisionId: "rev_import_verification" as RevisionId,
        sketchId: VERIFICATION_SKETCH_ID,
        solvedSnapshot,
        definition: translation.definition,
      });
      if (regions.some((region) => region.isClosed)) {
        return unresolved(
          "onshape-surface-profile-wire-filter-ambiguous",
          `The whole-sketch wire query for ${label} names sketch ${sketchFeatureId}, which derives closed regions; the exact BodyType.WIRE selection cannot be read from the capture.`,
        );
      }
      selected.push(
        ...translation.definition.entities.filter(
          (entity) => entity.kind !== "point" && !entity.isConstruction,
        ),
      );
      continue;
    }
    const entity = translation.definition.entities.find(
      (candidate) => candidate.label === entry.sketchEntityId,
    );
    if (!entity || entity.kind === "point" || entity.isConstruction) {
      return unresolved(
        "onshape-surface-profile-entity-unmatched",
        `The surface profile entity ${entry.sketchEntityId} for ${label} is not a translated open curve of sketch ${sketchFeatureId}.`,
      );
    }
    selected.push(entity);
  }

  const unique = [
    ...new Map(selected.map((entity) => [entity.entityId, entity])).values(),
  ];
  if (!formsOneConnectedChain(unique, translation.definition)) {
    return unresolved(
      "onshape-surface-profile-chain-disconnected",
      `The surface profile entities for ${label} do not form exactly one connected chain.`,
    );
  }

  return {
    tier: "resolved",
    profiles: unique.map((entity) => ({
      kind: "sketchCurve" as const,
      sketchFeatureId,
      entityId: entity.entityId,
    })),
    diagnostics,
  };
}
