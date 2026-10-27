import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { OwnershipRecord } from "@/contracts/shared/diagnostics";
import {
  getSessionSketchId,
  getSketchSessionDerivedValidity,
  getSketchSessionDisplayDefinition,
  getSketchSessionDisplayProjectedReferences,
} from "@/core/editor/sketch-session";
import { getSketchSessionDisplaySolvedSnapshot } from "@/core/editor/sketch-session/solved-snapshot";
import type { SketchSessionState } from "@/core/editor/sketch-session/types";
import type { OpenSketchMeasurementRecord } from "@/core/measure/measurement";

/**
 * The open sketch as the readout measures it (cadara-h026.3): its live
 * geometry, not the last commit (a new sketch has none). Points and circle
 * radii are the live solve's, as sketch mode draws them; while the sketch is
 * not current they are the held (authored) ones, which the readout says it
 * measures (T17d). Validity, projected references and regions are the
 * session's live ones, the regions with the basis they were derived from.
 */
export function openSketchMeasurementRecord(
  snapshot: WorkspaceSnapshot,
  session: SketchSessionState,
): OpenSketchMeasurementRecord {
  const sketchId = getSessionSketchId(session);
  const committed = snapshot.document.sketches.find(
    (entry) => entry.sketchId === sketchId,
  );
  const ownership: OwnershipRecord = committed
    ? {
        ownerDocumentId: committed.ownerDocumentId,
        ownerRevisionId: committed.ownerRevisionId,
        ownerFeatureId: committed.ownerFeatureId,
        ownerSketchId: committed.ownerSketchId,
        ownerBodyId: committed.ownerBodyId,
      }
    : {
        ownerDocumentId: snapshot.document.documentId,
        ownerRevisionId: snapshot.document.revisionId,
        ownerFeatureId: null,
        ownerSketchId: sketchId,
        ownerBodyId: null,
      };
  const displayDefinition = getSketchSessionDisplayDefinition(session);
  const solvedSnapshot = getSketchSessionDisplaySolvedSnapshot(session);
  const derivedValidity = getSketchSessionDerivedValidity(session);
  const solved =
    derivedValidity.state === "current"
      ? solvedSnapshot
      : { solvedPoints: [], solvedEntities: [] };
  const solvedPositions = new Map(
    solved.solvedPoints.map(
      (point) => [point.pointId, point.solvedPosition] as const,
    ),
  );
  const solvedRadii = new Map(
    solved.solvedEntities.flatMap((entity) =>
      entity.kind === "circle"
        ? [[entity.entityId, entity.solvedRadius] as const]
        : [],
    ),
  );
  const definition = {
    ...displayDefinition,
    points: displayDefinition.points.map((point) => {
      const position = solvedPositions.get(point.pointId);
      return position ? { ...point, position } : point;
    }),
    entities: displayDefinition.entities.map((entity) => {
      const radius =
        entity.kind === "circle" ? solvedRadii.get(entity.entityId) : undefined;
      return radius === undefined ? entity : { ...entity, radius };
    }),
  };
  return {
    record: {
      ...ownership,
      sketchId,
      label: session.sketchLabel,
      plane: session.plane,
      sketch: {
        ...ownership,
        sketchId,
        label: session.sketchLabel,
        planeSupport: session.planeTarget,
        definition,
        solvedSnapshot,
        derivedValidity,
        projectedReferences: getSketchSessionDisplayProjectedReferences(
          session,
          displayDefinition,
        ),
        regions: session.liveRegions.regions,
      },
    },
    regionBasis: session.liveRegions.boundaryBasis,
  };
}
