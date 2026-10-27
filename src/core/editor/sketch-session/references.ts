import type { ReferenceImageOperationState } from "@/contracts/reference-image/schema";
import type { SketchAuthoringOperationId } from "@/contracts/shared/ids";
import type {
  SketchReferenceImageRecord,
  SketchEntityDefinition,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import { stripReferenceImageRuntimeState, createDefaultReferenceImageCalibrationState, solveReferenceImageOperationState, replaceReferenceImagePayloadPreservingCalibration } from "@/core/reference-image-calibration/state";
import { validateReferenceImageOperationState } from "@/contracts/reference-image/runtime-schema";
import type { SketchSessionState } from "./types";
import { createReferenceImageOperation } from "@/core/reference-image/operations";
import { getSessionSketchId } from "./tool-authoring";
import { hasAcceptedLiveSolveOfDefinition } from "./session-live-solve";
import { appendDefinition } from "./definition-authoring";
import { getSketchSessionInvalidFeedback } from "./session-feedback";
import { mergeDerivedProjectedReferences } from "./session-definition";
import { rebuildSessionCommitRequest } from "./tool-authoring";
import { withLiveSolveBasis } from "./session-live-solve";

/** One explicit image intent delegates to the same append owner as browser imports. */
export function authorReferenceImage(
  session: SketchSessionState,
  payload: import("@/contracts/reference-image/schema").ReferenceImagePayload,
): SketchSessionState {
  return appendReferenceImageOperations(session, [createReferenceImageOperation({
    sequence: session.sequence + 1,
    sketchId: getSessionSketchId(session),
    payload,
  })]);
}

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

/** Explicit placement/settings/replacement prepare the same owned-state update used by calibration. */
export function editReferenceImage(
  session: SketchSessionState,
  operationId: SketchAuthoringOperationId,
  edit: import("@/contracts/semantic/schema").SemanticReferenceImageEdit | { kind: "replace"; image: import("@/contracts/reference-image/schema").ReferenceImagePayload },
): SketchSessionState {
  const record = session.definition.referenceImages?.find(r => r.operationId === operationId);
  if (!record) return { ...session, validationMessage: "Reference image is unavailable." };
  const calibration = record.ownedState.calibration ?? createDefaultReferenceImageCalibrationState();
  const state = edit.kind === "placement"
    ? { ...record.ownedState, placement: edit.placement }
    : edit.kind === "settings"
      ? { ...record.ownedState, calibration: { ...calibration, scaleMode: edit.scaleMode, showExportedAnchorsInSketch: edit.showExportedAnchorsInSketch } }
      : { ...record.ownedState, image: edit.image };
  const checked = validateReferenceImageOperationState(state);
  if (!checked.success) return { ...session, validationMessage: checked.issues[0]?.message ?? "Invalid reference image settings." };
  if (calibration.anchors.length && !hasAcceptedLiveSolveOfDefinition(session))
    return { ...session, validationMessage: "Reference image calibration requires current accepted sketch points." };
  const pointPositionsById = new Map(session.liveSolve?.solvedSnapshot.solvedPoints.map(p => [p.pointId, p.solvedPosition]) ?? []);
  const solved = edit.kind === "replace"
    ? replaceReferenceImagePayloadPreservingCalibration({ state: record.ownedState, image: edit.image, pointPositionsById })
    : solveReferenceImageOperationState(checked.data, { pointPositionsById });
  const label = edit.kind === "replace" ? edit.image.fileName ?? record.label : record.label;
  if (label === record.label && JSON.stringify(stripReferenceImageRuntimeState(solved)) === JSON.stringify(stripReferenceImageRuntimeState(record.ownedState)))
    return { ...session, validationMessage: null };
  return updateReferenceImageOperationStates({ session: { ...session, validationMessage: null }, updates: [{ operationId, state: solved, label }] });
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
