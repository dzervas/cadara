import type { ReferenceImageOperationState } from "@/contracts/reference-image/schema";
import type { SketchAuthoringOperationId } from "@/contracts/shared/ids";
import type {
  SketchAuthoringOperation,
  SketchEntityDefinition,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import {
  collectActiveReferenceImageOperations,
  createReferenceImageEditOperation,
} from "@/domain/reference-image/operations";
import type { SketchSessionState } from "./types";
import {
  applySketchHistoryContribution,
  getHistorySequence,
  mergeDerivedProjectedReferences,
  rebuildSessionForDefinition,
  withLiveSolvedRegions,
} from "./internals";

export function appendReferenceImageOperations(
  session: SketchSessionState,
  operations: readonly SketchAuthoringOperation[],
): SketchSessionState {
  if (operations.length === 0) {
    return session;
  }

  const history = applySketchHistoryContribution(session, {
    points: [...(operations[0]!.createdGraph?.points ?? [])],
    entities: [...(operations[0]!.createdGraph?.entities ?? [])],
    ...(operations[0]!.createdGraph?.constraints
      ? { constraints: [...operations[0]!.createdGraph.constraints] }
      : {}),
    ...(operations[0]!.createdGraph?.dimensions
      ? { dimensions: [...operations[0]!.createdGraph.dimensions] }
      : {}),
    ...(operations[0]!.createdGraph?.derivedRelationships
      ? {
          derivedRelationships: [
            ...operations[0]!.createdGraph.derivedRelationships,
          ],
        }
      : {}),
    authoringOperation: operations[0]!,
  });

  let nextSession = rebuildSessionForDefinition(session, {
    definition: history.definition,
    fullDefinition: history.fullDefinition,
    historyCursor: history.historyCursor,
    historyOperations: history.historyOperations,
  });

  for (const operation of operations.slice(1)) {
    const appended = applySketchHistoryContribution(nextSession, {
      points: [...(operation.createdGraph?.points ?? [])],
      entities: [...(operation.createdGraph?.entities ?? [])],
      ...(operation.createdGraph?.constraints
        ? { constraints: [...operation.createdGraph.constraints] }
        : {}),
      ...(operation.createdGraph?.dimensions
        ? { dimensions: [...operation.createdGraph.dimensions] }
        : {}),
      ...(operation.createdGraph?.derivedRelationships
        ? {
            derivedRelationships: [
              ...operation.createdGraph.derivedRelationships,
            ],
          }
        : {}),
      authoringOperation: operation,
    });
    nextSession = rebuildSessionForDefinition(nextSession, {
      definition: appended.definition,
      fullDefinition: appended.fullDefinition,
      historyCursor: appended.historyCursor,
      historyOperations: appended.historyOperations,
    });
  }

  return {
    ...nextSession,
    sequence: Math.max(
      session.sequence,
      ...operations.map((operation) =>
        getHistorySequence(operation.operationId),
      ),
    ),
  };
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
  if (input.updates.length === 0) {
    return input.session;
  }

  const activeOperationIds = new Set(
    collectActiveReferenceImageOperations(input.session.definition).map(
      ({ operation }) => operation.operationId,
    ),
  );
  const operations = input.updates.flatMap((update, index) =>
    activeOperationIds.has(update.operationId)
      ? [
          createReferenceImageEditOperation({
            sequence: input.session.sequence + index + 1,
            operationId: update.operationId,
            state: update.state,
            label: update.label,
            createdPoints: update.createdPoints,
            createdEntities: update.createdEntities,
          }),
        ]
      : [],
  );

  return appendReferenceImageOperations(input.session, operations);
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
  const validationMessage =
    projectionDiagnostics.find((diagnostic) => diagnostic.severity !== "info")
      ?.message ?? null;

  return withLiveSolvedRegions({
    ...session,
    projectedReferences: mergedProjectedReferences,
    projectionDiagnostics,
    validationMessage,
  });
}
