import type { ReferenceImageOperationState } from "@/contracts/reference-image/schema";
import type { SketchAuthoringOperationId } from "@/contracts/shared/ids";
import type {
  SketchReferenceImageRecord,
  SketchEntityDefinition,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import { stripReferenceImageRuntimeState } from "@/domain/reference-image-calibration/state";
import type { SketchSessionState } from "./types";
import {
  appendDefinition,
  getSketchSessionInvalidFeedback,
  mergeDerivedProjectedReferences,
  rebuildSessionCommitRequest,
  withLiveSolveBasis,
} from "./internals";

export function appendReferenceImageOperations(
  session: SketchSessionState,
  records: readonly SketchReferenceImageRecord[],
): SketchSessionState {
  if (records.length === 0) return session;
  const definition = {
    ...session.definition,
    referenceImages: [
      ...(session.definition.referenceImages ?? []),
      ...records,
    ],
  };
  return withLiveSolveBasis(
    {
      ...session,
      definition,
      sequence: session.sequence + 1,
      commitRequest: rebuildSessionCommitRequest(session, definition),
    },
    definition,
  );
}

export function updateReferenceImageOperationStates(input: {
  session: SketchSessionState;
  updates: ReadonlyArray<{
    operationId: SketchAuthoringOperationId;
    state: ReferenceImageOperationState;
    label?: string;
    createdPoints?: readonly SketchPointDefinition[];
    createdEntities?: readonly SketchEntityDefinition[];
  }>;
}): SketchSessionState {
  const updates = input.updates.filter((update) =>
    input.session.definition.referenceImages?.some(
      (record) => record.operationId === update.operationId,
    ),
  );
  if (updates.length === 0) return input.session;
  let definition = input.session.definition;
  for (const update of updates) {
    definition = appendDefinition(definition, {
      points: [...(update.createdPoints ?? [])],
      entities: [...(update.createdEntities ?? [])],
    });
    definition = {
      ...definition,
      referenceImages: definition.referenceImages?.map((record) =>
        record.operationId === update.operationId
          ? {
              ...record,
              label: update.label ?? record.label,
              ownedPointIds: [
                ...new Set([
                  ...record.ownedPointIds,
                  ...(update.createdPoints ?? []).map((point) => point.pointId),
                ]),
              ],
              ownedEntityIds: [
                ...new Set([
                  ...record.ownedEntityIds,
                  ...(update.createdEntities ?? []).map(
                    (entity) => entity.entityId,
                  ),
                ]),
              ],
              ownedState: stripReferenceImageRuntimeState(update.state),
            }
          : record,
      ),
    };
  }
  return withLiveSolveBasis(
    {
      ...input.session,
      definition,
      sequence: input.session.sequence + 1,
      commitRequest: rebuildSessionCommitRequest(input.session, definition),
    },
    definition,
  );
}

/** T17e: why a reference is not projected, in words (never the status code). */
const PROJECTION_STATUS_TEXT: Record<
  Exclude<ProjectedSketchReferenceRecord["status"], "projected">,
  string
> = {
  unsupportedSource: "its source can't be projected",
  missingSource: "its source no longer exists",
  outOfPlane: "its source is not in the sketch plane",
  ambiguous: "its source is ambiguous",
};

export function updateSketchReferenceProjection(
  session: SketchSessionState,
  projectedReferences: ProjectedSketchReferenceRecord[],
  diagnostics: ProjectedSketchReferenceRecord["diagnostics"],
): SketchSessionState {
  const mergedProjectedReferences = mergeDerivedProjectedReferences(
    session.definition,
    projectedReferences,
  );
  const referenceName = (referenceId: string) => {
    const label = session.definition.references.find(
      (entry) => entry.referenceId === referenceId,
    )?.label;
    return label === undefined ? "A reference" : `Reference ‘${label}’`;
  };
  const referenceDiagnostics = mergedProjectedReferences.flatMap(
    (reference) => [
      ...reference.diagnostics,
      ...(reference.status === "projected"
        ? []
        : [
            {
              code: `external-reference-${reference.status}`,
              severity: "warning" as const,
              // T17e (review A-7): by the reference's label, the status in words.
              message: `${referenceName(reference.referenceId)} is not projected: ${PROJECTION_STATUS_TEXT[reference.status]}.`,
              target: null,
            },
          ]),
    ],
  );
  const projectionDiagnostics = [...diagnostics, ...referenceDiagnostics];
  const based = withLiveSolveBasis(
    {
      ...session,
      projectedReferences: mergedProjectedReferences,
      projectionDiagnostics,
      validationMessage:
        projectionDiagnostics.find(
          (diagnostic) => diagnostic.severity !== "info",
        )?.message ?? null,
    },
    session.definition,
  );
  // T13c (R-2): a (re)opened invalid sketch says why, as after Undo/Redo.
  return based.validationMessage === null &&
    based.liveRegions.status === "unavailable"
    ? { ...based, validationMessage: getSketchSessionInvalidFeedback(based) }
    : based;
}
