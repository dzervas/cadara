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
import { deriveLiveBodySignatures } from "@/domain/import/live-body-signatures";
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

export interface MemoizedHistoryProbe extends ImportHistoryProbeCapabilities {
  /**
   * Drop retained failures so the contained plan is probed again. Review calls
   * this exactly when its containment pass has run against a changed plan.
   */
  forgetFailedEvaluations(): void;
}

/**
 * Memoize probe evaluations on the exact prepared-action payload they run.
 *
 * Each evaluation rebuilds the whole prefix in a fresh isolated session, so it
 * is a pure function of that payload: the same actions always produce the same
 * steps and signatures. Review probes the same prefix many times — once per
 * topology consumer and once per fixed-point iteration — and the largest
 * captures cannot afford those redundant kernel rebuilds. The cache is keyed on
 * the payload itself (never on a consumer id or plan revision), so a changed
 * plan always misses it.
 *
 * A failed or throwing evaluation is retained too, but only until the plan it was
 * probed against changes. It is the input to review's containment pass, which
 * exists to change the conditions the probe failed under; until that pass runs,
 * re-evaluating the identical payload can only reproduce the identical failure at
 * full kernel cost. 9841 probes one unbuildable prefix from every downstream
 * consumer inside a single pass, and paying for each of those rebuilds put its
 * review past its wait cap.
 */
export function createMemoizedHistoryProbe(
  history: ImportHistoryProbeCapabilities,
): MemoizedHistoryProbe {
  const cache = new Map<string, Promise<HistoryProbeResult>>();
  const failedKeys = new Set<string>();
  return {
    evaluateHistoryProbe(input) {
      const key = JSON.stringify({
        actions: input.actions,
        includeFinalTessellation: input.includeFinalTessellation ?? false,
      });
      const cached = cache.get(key);
      if (cached) return cached;
      const pending = history.evaluateHistoryProbe(input).then(
        (result) => {
          if (result.steps.some((step) => step.status === "failed")) failedKeys.add(key);
          return result;
        },
        (error: unknown) => {
          failedKeys.add(key);
          throw error;
        },
      );
      cache.set(key, pending);
      return pending;
    },
    forgetFailedEvaluations() {
      for (const key of failedKeys) cache.delete(key);
      failedKeys.clear();
    },
  };
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
    const signatureResult = await deriveLiveBodySignatures({ snapshot, service });
    if (signatureResult.status === "unavailable") {
      steps.push({ status: "failed", diagnostics: signatureResult.diagnostics });
      return { steps };
    }
    const diagnostics: HistoryProbeStepDiagnostic[] = signatureResult.diagnostics;

    steps.push(
      diagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? { status: "failed", diagnostics }
        : { status: "rebuilt", signatures: signatureResult.signatures },
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
      // Apply rejects a feature whose result carries an error diagnostic or a
      // non-accepted revision state, even though the Result envelope is Ok
      // (see `requireAcceptedModelingResult` in the orchestrator). The probe
      // must reject on exactly the same condition, or review promotes a feature
      // that commit then refuses — which aborts the whole studio instead of
      // baking one feature. Reference invalidations raised by an earlier
      // feature's conservative stage history surface only this way.
      if (result.isOk()) {
        const rejection = describeRejectedFeatureResult(result.value);
        if (rejection) return { ok: false, message: rejection };
      }
      if (result.isOk()) {
        materializer.recordFeatureOutput(orderedPosition, result.value.featureId);
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

/**
 * Describe why apply would refuse this feature result, or `null` when apply
 * would accept it. Mirrors the orchestrator's acceptance rule exactly: an error
 * diagnostic or a non-accepted revision state is a refusal, and the kernel's own
 * first error message is preserved so the reason names the real cause.
 *
 * The user-facing message names the authored field but not the reference, so the
 * refused durable target is appended verbatim. Without it a stage-lineage
 * refusal reads only as "edge selection is incorrect" and the offending entity
 * has to be guessed.
 */
function describeRejectedFeatureResult(value: {
  revisionState?: { kind?: string };
  diagnostics?: readonly {
    severity: string;
    code?: string;
    message: string;
    target?: DurableRef | null;
  }[];
}): string | null {
  const errorDiagnostic = (value.diagnostics ?? []).find(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errorDiagnostic) {
    const target = describeRefusedTarget(errorDiagnostic.target);
    return `${errorDiagnostic.code ?? "feature-rejected"}: ${errorDiagnostic.message}${target}`;
  }
  const revisionKind = value.revisionState?.kind;
  return revisionKind !== undefined && revisionKind !== "accepted"
    ? `feature-rejected: the kernel returned revision state ${revisionKind}.`
    : null;
}

function describeRefusedTarget(target: DurableRef | null | undefined) {
  if (!target) {
    return "";
  }
  const suffix =
    target.kind === "face"
      ? target.faceId
      : target.kind === "edge"
        ? target.edgeId
        : target.kind === "vertex"
          ? target.vertexId
          : target.kind === "body"
            ? target.bodyId
            : null;
  return suffix === null
    ? ` [refused target ${target.kind}]`
    : ` [refused target ${target.kind} ${suffix}]`;
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
