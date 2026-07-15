import type {
  HistoryProbeInput,
  HistoryProbeResult,
  HistoryProbeStepDiagnostic,
  ImportHistoryProbeCapabilities,
} from "@/contracts/import/capabilities";
import type {
  ImportPreparedActionRef,
  ImportPreparedActions,
} from "@/contracts/import/actions";
import type { BodyId, RevisionId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import { deriveKernelTopologySignaturesFromExactBrepPayload } from "@/domain/modeling/occ/topology-signatures";
import {
  ImportDeferredMaterializer,
  type ImportActionOutputRecord,
} from "@/domain/import/orchestrator";

type KernelHistoryProbeService = Pick<
  ModelingService,
  | "addDocumentVariable"
  | "buildNativeExactBrepPayload"
  | "commitSketch"
  | "createFeature"
  | "getCurrentDocumentSnapshot"
>;

export interface KernelHistoryProbeSessionOptions {
  /** Must be an isolated modeling service/session owned by the probe caller. */
  service?: KernelHistoryProbeService;
  /** Creates a fresh isolated session for each probe evaluation. */
  createService?: () => KernelHistoryProbeService & { dispose?: () => void };
}

export function createKernelHistoryProbeSession(
  options: KernelHistoryProbeSessionOptions,
): ImportHistoryProbeCapabilities {
  return {
    async evaluateHistoryProbe(input) {
      const service = (options.createService?.() ?? options.service) as
        | (KernelHistoryProbeService & { dispose?: () => void })
        | undefined;
      if (!service) {
        return {
          steps: [
            {
              status: "failed",
              diagnostics: [
                {
                  severity: "error",
                  code: "kernel-history-probe-missing-session",
                  message: "Kernel history probe requires an isolated modeling session.",
                },
              ],
            },
          ],
        };
      }

      try {
        return await evaluateHistoryProbeInKernelSession(input, service);
      } finally {
        service.dispose?.();
      }
    },
  };
}

async function evaluateHistoryProbeInKernelSession(
  input: HistoryProbeInput,
  service: KernelHistoryProbeService,
): Promise<HistoryProbeResult> {
  const actionRefs = getOrderedActionRefs(input.actions);
  const steps: HistoryProbeResult["steps"] = [];
  const materializer = new ImportDeferredMaterializer({
    modelingService: service,
    outputRecords: new Map<string, ImportActionOutputRecord>(),
  });

  for (const [orderedPosition, actionRef] of actionRefs.entries()) {
    const applyResult = await applyProbeAction(
      service,
      input.actions,
      actionRef,
      orderedPosition,
      materializer,
    );
    if (!applyResult.ok) {
      steps.push({
        status: "failed",
        diagnostics: [
          {
            severity: "error",
            code: "kernel-history-probe-step-failed",
            message: `History probe failed at step ${orderedPosition + 1}: ${applyResult.message}`,
          },
        ],
      });
      return { steps };
    }

    const snapshot = await service.getCurrentDocumentSnapshot();
    const signatures = [];
    const diagnostics: HistoryProbeStepDiagnostic[] = [];

    for (const body of snapshot.document.bodies) {
      const result = await service.buildNativeExactBrepPayload({
        baseRevisionId: snapshot.document.revisionId,
        target: { kind: "body", bodyId: body.bodyId as BodyId },
      });

      if (result.kind !== "nativeTopologyPayload") {
        steps.push({
          status: "failed",
          diagnostics: result.diagnostics.map((diagnostic) => ({
            severity: diagnostic.severity,
            code: diagnostic.code,
            message: diagnostic.message,
          })),
        });
        return { steps };
      }

      const signatureResult = deriveKernelTopologySignaturesFromExactBrepPayload(
        result.payload,
      );
      if (signatureResult.status === "unavailable") {
        steps.push({
          status: "failed",
          diagnostics: signatureResult.diagnostics.map((diagnostic) => ({
            severity: diagnostic.severity,
            code: diagnostic.code,
            message: diagnostic.message,
          })),
        });
        return { steps };
      }

      signatures.push(...signatureResult.signatures);
      diagnostics.push(
        ...signatureResult.diagnostics.map((diagnostic) => ({
          severity: diagnostic.severity,
          code: diagnostic.code,
          message: diagnostic.message,
        })),
      );
    }

    steps.push(
      diagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? { status: "failed", diagnostics }
        : { status: "rebuilt", signatures },
    );

    if (steps[steps.length - 1]?.status === "failed") {
      return { steps };
    }
  }

  if (!input.includeFinalTessellation) {
    return { steps };
  }

  const finalSnapshot = await service.getCurrentDocumentSnapshot();
  return {
    steps,
    finalTessellation: {
      points: finalSnapshot.document.render.records.flatMap((record) =>
        record.geometry.kind === "mesh"
          ? record.geometry.vertexPositions.flatMap((point) => [...point])
          : [],
      ),
    },
  };
}

export function getOrderedActionRefs(actions: ImportPreparedActions): ImportPreparedActionRef[] {
  if (actions.orderedActions) {
    return [...actions.orderedActions];
  }

  return [
    ...(actions.addDocumentVariables ?? []).map((_, index) => ({
      kind: "addDocumentVariable" as const,
      index,
    })),
    ...(actions.commitSketches ?? []).map((_, index) => ({
      kind: "commitSketch" as const,
      index,
    })),
    ...(actions.createFeatures ?? []).map((_, index) => ({
      kind: "createFeature" as const,
      index,
    })),
  ];
}

/** Return a compact prepared-action prefix ending immediately before a consumer. */
export function takePreparedActionPrefix(
  actions: ImportPreparedActions,
  exclusiveOrderedPosition: number,
): ImportPreparedActions {
  const refs = getOrderedActionRefs(actions).slice(0, exclusiveOrderedPosition);
  const addDocumentVariables: NonNullable<ImportPreparedActions["addDocumentVariables"]> = [];
  const commitSketches: NonNullable<ImportPreparedActions["commitSketches"]> = [];
  const createFeatures: NonNullable<ImportPreparedActions["createFeatures"]> = [];
  const orderedActions: ImportPreparedActionRef[] = [];

  for (const ref of refs) {
    switch (ref.kind) {
      case "addDocumentVariable":
        addDocumentVariables.push(actions.addDocumentVariables![ref.index]!);
        orderedActions.push({ kind: ref.kind, index: addDocumentVariables.length - 1 });
        break;
      case "commitSketch":
        commitSketches.push(actions.commitSketches![ref.index]!);
        orderedActions.push({ kind: ref.kind, index: commitSketches.length - 1 });
        break;
      case "createFeature":
        createFeatures.push(actions.createFeatures![ref.index]!);
        orderedActions.push({ kind: ref.kind, index: createFeatures.length - 1 });
        break;
    }
  }

  return { addDocumentVariables, commitSketches, createFeatures, orderedActions };
}

async function applyProbeAction(
  service: KernelHistoryProbeService,
  actions: ImportPreparedActions,
  actionRef: ImportPreparedActionRef,
  orderedPosition: number,
  materializer: ImportDeferredMaterializer,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const snapshot = await service.getCurrentDocumentSnapshot();
  const basis = {
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId as RevisionId,
  };

  switch (actionRef.kind) {
    case "addDocumentVariable": {
      const request = actions.addDocumentVariables?.[actionRef.index];
      if (!request) {
        return missingAction(actionRef);
      }
      const result = await service.addDocumentVariable({ ...request, ...basis });
      return result.isOk() ? { ok: true } : { ok: false, message: result.error.message };
    }
    case "commitSketch": {
      const request = actions.commitSketches?.[actionRef.index];
      if (!request) {
        return missingAction(actionRef);
      }
      const materialized = await materializer.materializeCommitSketchRequest(
        request,
        actionRef,
      );
      const result = await service.commitSketch({ ...materialized, ...basis });
      if (result.isOk()) {
        materializer.recordSketchOutput(orderedPosition, result.value.sketchId);
        return { ok: true };
      }
      return { ok: false, message: result.error.message };
    }
    case "createFeature": {
      const request = actions.createFeatures?.[actionRef.index];
      if (!request) {
        return missingAction(actionRef);
      }
      const materialized = await materializer.materializeFeatureRequest(
        request,
        actionRef,
      );
      const result = await service.createFeature({ ...materialized, ...basis });
      if (result.isOk()) {
        materializer.recordBodyOutput(
          orderedPosition,
          (result.value.changedTargets ?? []).flatMap((target) =>
            target.kind === "body" ? [target.bodyId] : [],
          ),
        );
        const constructionIds = (result.value.changedTargets ?? []).flatMap(
          (target) =>
            target.kind === "construction" ? [target.constructionId] : [],
        );
        if (constructionIds.length > 0) {
          materializer.recordConstructionOutput(orderedPosition, constructionIds);
        }
        return { ok: true };
      }
      return { ok: false, message: result.error.message };
    }
  }
}

function missingAction(actionRef: ImportPreparedActionRef) {
  return {
    ok: false as const,
    message: `Missing prepared action ${actionRef.kind}[${actionRef.index}].`,
  };
}

export function bodyRef(bodyId: BodyId): DurableRef {
  return { kind: "body", bodyId };
}
