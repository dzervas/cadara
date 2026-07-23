import type { ImportDeferredTopologyRef } from "@/contracts/import/actions";
import type { OnshapeProfileEvidence } from "@/contracts/import/onshape-capture-bundle";
import type { DocumentId, RevisionId, SketchId } from "@/contracts/shared/ids";
import type { SketchPlaneFrame, SketchPlaneKey } from "@/contracts/shared/sketch-plane";
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  type SketchDefinition,
  type SketchPoint2D,
  type SolvedSketchEntityGeometryRecord,
  type SolvedSketchPointRecord,
  type SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { deriveSketchRegionsCore } from "@/contracts/sketch/region-extraction";
import {
  countContainingRegions,
  selectInnermostContainingRegion,
  type RegionSelectionSketch,
} from "@/domain/import/region-containment";
import type { OnshapeSolvedSketch } from "@/domain/import/onshape/bundle-reader";
import { DEFAULT_MATCH_TOLERANCE } from "@/domain/import/onshape/signature-matcher";
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
  /** Sketch-plane interior point that selects exactly one region at apply time. */
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
  const profiles = [...legacyInteriorPoint(selectionSketch)].map(({ interiorPoint }) => ({
    kind: "sketchRegion" as const,
    sketchFeatureId,
    interiorPoint,
  }));
  return profiles.length > 0
    ? { tier: "resolved", profiles, diagnostics: [] }
    : { tier: "unresolved", reason: "needs-region-resolution", diagnostics: [] };
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
      .sort((left, right) => (left.resultIndex ?? -1) - (right.resultIndex ?? -1));
    if (queryEvidence.length === 0 || queryEvidence.some((record) => record.kind === "unresolved")) {
      diagnostics.push({
        code: "onshape-profile-evidence-unresolved",
        message: `No complete exact evidence was captured for ${input.featureKind} "${input.featureLabel}" profile query ${queryIndex}.`,
      });
      return { tier: "unresolved", reason: "needs-region-resolution", diagnostics };
    }
    if (queryEvidence.some((record, resultIndex) => record.resultIndex !== resultIndex)) {
      diagnostics.push({
        code: "onshape-profile-evidence-order-invalid",
        message: `Exact profile evidence for ${input.featureKind} "${input.featureLabel}" query ${queryIndex} has a missing or duplicate result index.`,
      });
      return { tier: "unresolved", reason: "needs-region-resolution", diagnostics };
    }
    for (const record of queryEvidence) {
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
