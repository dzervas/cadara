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

export function updateSketchReferenceProjection(
  session: SketchSessionState,
  projectedReferences: ProjectedSketchReferenceRecord[],
  diagnostics: ProjectedSketchReferenceRecord["diagnostics"],
): SketchSessionState {
  const mergedProjectedReferences = mergeDerivedProjectedReferences(
    session.definition,
    projectedReferences,
  );
  const referenceDiagnostics = mergedProjectedReferences.flatMap(
    (reference) => [
      ...reference.diagnostics,
      ...(reference.status === "projected"
        ? []
        : [
            {
              code: `external-reference-${reference.status}`,
              severity: "warning" as const,
              message: `Reference ${reference.referenceId} projection status: ${reference.status}.`,
              target: null,
            },
          ]),
    ],
  );
  const projectionDiagnostics = [...diagnostics, ...referenceDiagnostics];
  return withLiveSolveBasis(
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
}
