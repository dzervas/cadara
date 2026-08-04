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
import type { BodyId, DocumentId, RevisionId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import { deriveLiveBodySignatures } from "@/domain/import/live-body-signatures";
import {
  ImportDeferredMaterializer,
  isTopologyApplyRematchError,
  TopologyApplyRematchError,
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

type DisposableKernelHistoryProbeService = KernelHistoryProbeService & {
  dispose?: () => void | Promise<void>;
};

export interface KernelHistoryProbeSessionOptions {
  /** Must be an isolated modeling service/session owned by the probe caller. */
  service?: DisposableKernelHistoryProbeService;
  /**
   * Creates an isolated session. The session is retained only while later
   * evaluations are exact action-prefix extensions; divergence disposes it and
   * starts fresh.
   */
  createService?: () => DisposableKernelHistoryProbeService;
}

export interface MemoizedHistoryProbe extends ImportHistoryProbeCapabilities {
  /**
   * Drop retained failures so the contained plan is probed again. Review calls
   * this exactly when its containment pass has run against a changed plan.
   */
  forgetFailedEvaluations(): void;
}

/**
 * Memoize exact evaluations and proven failed action prefixes.
 *
 * Successful results stay keyed on the complete request because requested
 * signatures and tessellation are observable. A failed step is stronger: any
 * longer evaluation with the identical action sequence through that step must
 * fail there before its suffix can run. Reusing that result avoids rebuilding
 * an expensive known-bad prefix for every downstream consumer. Signature
 * samples before the failure are reused only when the retained evaluation
 * actually sampled the newly requested ordinals. Containment explicitly drops
 * all retained failures after it changes the plan.
 */
export function createMemoizedHistoryProbe(
  history: ImportHistoryProbeCapabilities,
): MemoizedHistoryProbe {
  const cache = new Map<string, Promise<HistoryProbeResult>>();
  const failedKeys = new Set<string>();
  const failedPrefixes: {
    actionKeys: readonly string[];
    result: HistoryProbeResult;
    sampledOrdinals: ReadonlySet<number> | null;
    containTopologyRematchFailures: boolean;
  }[] = [];

  return {
    evaluateHistoryProbe(input) {
      const actionKeys = getOrderedActionKeys(input.actions);
      const retainedFailure = input.requireFreshExecution
        ? undefined
        : failedPrefixes.find((failure) => canReuseFailedPrefix(failure, input, actionKeys));
      if (retainedFailure) return Promise.resolve(retainedFailure.result);

      const key = JSON.stringify({
        actions: input.actions,
        includeFinalTessellation: input.includeFinalTessellation ?? false,
        requestedSignatureStepOrdinals: input.requestedSignatureStepOrdinals ?? null,
        containTopologyRematchFailures: input.containTopologyRematchFailures ?? false,
        requireFreshExecution: input.requireFreshExecution ?? false,
      });
      const cached = input.requireFreshExecution ? undefined : cache.get(key);
      if (cached) return cached;
      const pending = history.evaluateHistoryProbe(input).then(
        (result) => {
          const failedOrdinal = result.steps.findIndex((step) => step.status === "failed");
          if (failedOrdinal >= 0) {
            failedKeys.add(key);
            failedPrefixes.push({
              actionKeys: actionKeys.slice(0, failedOrdinal + 1),
              result,
              sampledOrdinals:
                input.requestedSignatureStepOrdinals === undefined
                  ? null
                  : new Set(input.requestedSignatureStepOrdinals),
        containTopologyRematchFailures: input.containTopologyRematchFailures ?? false,
            });
          }
          return result;
        },
        (error: unknown) => {
          failedKeys.add(key);
          throw error;
        },
      );
      if (!input.requireFreshExecution) cache.set(key, pending);
      return pending;
    },
    forgetFailedEvaluations() {
      for (const key of failedKeys) cache.delete(key);
      failedKeys.clear();
      failedPrefixes.length = 0;
    },
    async dispose() {
      cache.clear();
      failedKeys.clear();
      failedPrefixes.length = 0;
      await history.dispose?.();
    },
  };
}

function canReuseFailedPrefix(
  failure: {
    actionKeys: readonly string[];
    result: HistoryProbeResult;
    sampledOrdinals: ReadonlySet<number> | null;
    containTopologyRematchFailures: boolean;
  },
  input: HistoryProbeInput,
  actionKeys: readonly string[],
) {
  if (
    failure.containTopologyRematchFailures !==
      (input.containTopologyRematchFailures ?? false) ||
    failure.actionKeys.length > actionKeys.length ||
    !failure.actionKeys.every((key, ordinal) => key === actionKeys[ordinal])
  ) {
    return false;
  }

  const failedOrdinal = failure.result.steps.findIndex(
    (step) => step.status === "failed",
  );
  if (input.requestedSignatureStepOrdinals === undefined) {
    return failure.sampledOrdinals === null;
  }
  return input.requestedSignatureStepOrdinals.every(
    (ordinal) =>
      ordinal >= failedOrdinal ||
      failure.sampledOrdinals === null ||
      failure.sampledOrdinals.has(ordinal),
  );
}

type RebuiltHistoryProbeStep = Extract<
  HistoryProbeResult["steps"][number],
  { status: "rebuilt" }
>;

type KernelHistoryProbeExecution = {
  service: DisposableKernelHistoryProbeService;
  actionKeys: string[];
  materializer: ImportDeferredMaterializer;
  signaturesByOrdinal: Map<number, RebuiltHistoryProbeStep["signatures"]>;
  evidenceByOrdinal: Map<number, NonNullable<RebuiltHistoryProbeStep["exactTopologyEvidence"]>>;
  outputRecords: Map<string, ImportActionOutputRecord>;
  basis: { documentId: DocumentId; baseRevisionId: RevisionId } | null;
};

function historicalWitnessActionIndexes(actions: ImportPreparedActions): ReadonlySet<number> {
  const indexes = new Set<number>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if ((value as { kind?: unknown }).kind === "historicalTopologyOf") {
      const index = (value as { witnessActionIndex?: unknown }).witnessActionIndex;
      if (typeof index === "number" && Number.isInteger(index)) indexes.add(index);
      return;
    }
    for (const entry of Array.isArray(value) ? value : Object.values(value)) visit(entry);
  };
  visit(actions);
  return indexes;
}

export function createKernelHistoryProbeSession(
  options: KernelHistoryProbeSessionOptions,
): ImportHistoryProbeCapabilities {
  // A fixed service preserves the legacy one-evaluation contract. Prefix
  // continuation requires a factory so a divergent action sequence can be
  // restarted in a genuinely fresh isolated document.
  if (!options.createService) {
    return {
      async evaluateHistoryProbe(input) {
        const service = options.service;
        if (!service) return missingProbeSessionResult();
        try {
          const execution = createProbeExecution(service);
          return (await evaluateHistoryProbeInKernelSession(input, execution)).result;
        } finally {
          await service.dispose?.();
        }
      },
    };
  }

  let execution: KernelHistoryProbeExecution | null = null;
  let serialized = Promise.resolve();

  const disposeExecution = async () => {
    const current = execution;
    execution = null;
    await current?.service.dispose?.();
  };

  const evaluate = async (input: HistoryProbeInput) => {
    const actionKeys = getOrderedActionKeys(input.actions);
    const historicalWitnesses = historicalWitnessActionIndexes(input.actions);
    if (input.requireFreshExecution && execution) {
      await disposeExecution();
    }
    if (!execution || !canContinueProbeExecution(execution, input, actionKeys, historicalWitnesses)) {
      await disposeExecution();
      execution = createProbeExecution(options.createService!());
    }
    execution.materializer.registerHistoricalSelectors(input.actions);
    for (const ordinal of historicalWitnesses) {
      if (ordinal >= execution.actionKeys.length) continue;
      const signatures = execution.signaturesByOrdinal.get(ordinal);
      if (!signatures) continue;
      await execution.materializer.bindHistoricalSelectorsAtAction(ordinal, {
        status: "available",
        signatures,
        exactTopologyEvidence: execution.evidenceByOrdinal.get(ordinal) ?? {
          topologyLineage: [],
          faceIncidence: [],
          actionOutputs: [],
        },
        diagnostics: [],
      });
    }

    try {
      const evaluated = await evaluateHistoryProbeInKernelSession(input, execution);
      if (!evaluated.reusable) await disposeExecution();
      return evaluated.result;
    } catch (error) {
      await disposeExecution();
      throw error;
    }
  };

  return {
    evaluateHistoryProbe(input) {
      const pending = serialized.then(
        () => evaluate(input),
        () => evaluate(input),
      );
      serialized = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
    async dispose() {
      await serialized;
      await disposeExecution();
    },
  };
}

function missingProbeSessionResult(): HistoryProbeResult {
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

function createProbeExecution(
  service: DisposableKernelHistoryProbeService,
): KernelHistoryProbeExecution {
  const outputRecords = new Map<string, ImportActionOutputRecord>();
  return {
    service,
    actionKeys: [],
    materializer: new ImportDeferredMaterializer({
      modelingService: service,
      outputRecords,
    }),
    signaturesByOrdinal: new Map(),
    evidenceByOrdinal: new Map(),
    outputRecords,
    basis: null,
  };
}

function canContinueProbeExecution(
  execution: KernelHistoryProbeExecution,
  input: HistoryProbeInput,
  actionKeys: readonly string[],
  historicalWitnesses: ReadonlySet<number>,
) {
  if (execution.actionKeys.length > actionKeys.length) return false;
  if (!execution.actionKeys.every((key, index) => key === actionKeys[index])) {
    return false;
  }
  if ([...historicalWitnesses].some(
    (ordinal) => ordinal < execution.actionKeys.length && !execution.signaturesByOrdinal.has(ordinal),
  )) return false;

  const requested = input.requestedSignatureStepOrdinals;
  if (requested === undefined) {
    return execution.actionKeys.every((_, index) =>
      execution.signaturesByOrdinal.has(index));
  }
  return requested.every(
    (ordinal) =>
      ordinal >= execution.actionKeys.length ||
      execution.signaturesByOrdinal.has(ordinal),
  );
}
async function evaluateHistoryProbeInKernelSession(
  input: HistoryProbeInput,
  execution: KernelHistoryProbeExecution,
): Promise<{ result: HistoryProbeResult; reusable: boolean }> {
  execution.materializer.registerHistoricalSelectors(input.actions);
  const actionRefs = getOrderedActionRefs(input.actions);
  const actionKeys = getOrderedActionKeys(input.actions);
  const requestedSignatureStepOrdinals = input.requestedSignatureStepOrdinals === undefined
    ? null
    : new Set(input.requestedSignatureStepOrdinals);
  const historicalWitnesses = execution.materializer.historicalWitnessActionIndexes();
  const steps: HistoryProbeResult["steps"] = execution.actionKeys.map((_, ordinal) => ({
    status: "rebuilt",
    signatures:
      requestedSignatureStepOrdinals === null ||
      requestedSignatureStepOrdinals.has(ordinal)
        ? execution.signaturesByOrdinal.get(ordinal) ?? []
        : [],
    ...(execution.evidenceByOrdinal.has(ordinal)
      ? { exactTopologyEvidence: execution.evidenceByOrdinal.get(ordinal)! }
      : {}),
  }));

  if (execution.actionKeys.length < actionRefs.length && execution.basis === null) {
    const snapshot = await execution.service.getCurrentDocumentSnapshot();
    execution.basis = {
      documentId: snapshot.document.documentId,
      baseRevisionId: snapshot.document.revisionId as RevisionId,
    };
  }

  for (
    let orderedPosition = execution.actionKeys.length;
    orderedPosition < actionRefs.length;
    orderedPosition += 1
  ) {
    const actionRef = actionRefs[orderedPosition]!;
    let applyResult: Awaited<ReturnType<typeof applyProbeAction>>;
    try {
      applyResult = await applyProbeAction(
        execution.service,
        input.actions,
        actionRef,
        orderedPosition,
        execution.materializer,
        execution.basis!,
      );
    } catch (error) {
      if (isTopologyApplyRematchError(error)) {
        if (!input.containTopologyRematchFailures) throw error;
        steps.push({
          status: "failed",
          diagnostics: [topologyApplyRematchDiagnostic(error, orderedPosition)],
        });
        return { result: { steps }, reusable: false };
      }
      applyResult = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
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
      return { result: { steps }, reusable: false };
    }

    execution.basis = {
      ...execution.basis!,
      baseRevisionId: applyResult.revisionId,
    };

    execution.actionKeys.push(actionKeys[orderedPosition]!);
    const historicalWitness = historicalWitnesses.has(orderedPosition);
    // Exact action evidence is needed independently of geometric signatures:
    // a later consumer may need this action's Modified hop even when it did not
    // request a geometric checkpoint at the same ordinal.

    const snapshot = await execution.service.getCurrentDocumentSnapshot();
    const signatureResult = await deriveLiveBodySignatures({
      snapshot,
      service: execution.service,
    });
    if (signatureResult.status === "unavailable") {
      steps.push({ status: "failed", diagnostics: signatureResult.diagnostics });
      return { result: { steps }, reusable: false };
    }
    const diagnostics: HistoryProbeStepDiagnostic[] = signatureResult.diagnostics;
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      steps.push({ status: "failed", diagnostics });
      return { result: { steps }, reusable: false };
    }
    const actionOutputs = [...execution.outputRecords].flatMap(([key, output]) => {
      const match = /^ordered:(\d+)$/.exec(key);
      if (!match) return [];
      return [{ actionIndex: Number(match[1]), ...output }];
    });
    const previouslyPublishedFeatureIds = new Set(
      [...execution.evidenceByOrdinal.values()].flatMap((evidence) =>
        evidence.topologyLineage.map((lineage) => lineage.featureId),
      ),
    );
    for (const lineage of signatureResult.exactTopologyEvidence.topologyLineage) {
      if (!previouslyPublishedFeatureIds.has(lineage.featureId)) {
        actionOutputs.push({ actionIndex: orderedPosition, featureId: lineage.featureId });
      }
    }
    const hasExactEvidence =
      signatureResult.exactTopologyEvidence.topologyLineage.length > 0 ||
      signatureResult.exactTopologyEvidence.faceIncidence.length > 0;
    const exactTopologyEvidence = {
      ...signatureResult.exactTopologyEvidence,
      actionOutputs: [...new Map(
        actionOutputs.map((output) => [
          `${output.actionIndex}:${output.featureId ?? ""}:${output.sketchId ?? ""}`,
          output,
        ]),
      ).values()],
    };
    execution.signaturesByOrdinal.set(orderedPosition, signatureResult.signatures);
    if (hasExactEvidence) {
      execution.evidenceByOrdinal.set(orderedPosition, exactTopologyEvidence);
    }
    execution.materializer.primeLiveSignatures(
      snapshot.document.revisionId,
      signatureResult,
    );
    if (historicalWitness) {
      await execution.materializer.bindHistoricalSelectorsAtAction(
        orderedPosition,
        signatureResult,
      );
    }
    await execution.materializer.advanceHistoricalSelectorsAtAction(orderedPosition);
    steps.push({
      status: "rebuilt",
      signatures:
        requestedSignatureStepOrdinals === null ||
        requestedSignatureStepOrdinals.has(orderedPosition)
          ? signatureResult.signatures
          : [],
      ...(hasExactEvidence ? { exactTopologyEvidence } : {}),
    });
  }

  if (!input.includeFinalTessellation) {
    return { result: { steps }, reusable: true };
  }

  const finalSnapshot = await execution.service.getCurrentDocumentSnapshot();
  return {
    result: {
      steps,
      finalTessellation: {
        points: finalSnapshot.document.render.records.flatMap((record) =>
          record.geometry.kind === "mesh"
            ? record.geometry.vertexPositions.flatMap((point) => [...point])
            : [],
        ),
      },
    },
    reusable: true,
  };
}

function getOrderedActionKeys(actions: ImportPreparedActions) {
  return getOrderedActionRefs(actions).map((actionRef) =>
    JSON.stringify({
      kind: actionRef.kind,
      request:
        actionRef.kind === "addDocumentVariable"
          ? actions.addDocumentVariables?.[actionRef.index]
          : actionRef.kind === "commitSketch"
            ? actions.commitSketches?.[actionRef.index]
            : actions.createFeatures?.[actionRef.index],
    }),
  );
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
  basis: { documentId: DocumentId; baseRevisionId: RevisionId },
): Promise<
  | { ok: true; revisionId: RevisionId }
  | { ok: false; message: string }
> {

  switch (actionRef.kind) {
    case "addDocumentVariable": {
      const request = actions.addDocumentVariables?.[actionRef.index];
      if (!request) {
        return missingAction(actionRef);
      }
      const result = await service.addDocumentVariable({ ...request, ...basis });
      if (result.isErr()) return { ok: false, message: result.error.message };
      materializer.invalidateLiveSignatures();
      return { ok: true, revisionId: result.value.revisionId };
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
        materializer.invalidateLiveSignatures();
        materializer.recordSketchOutput(orderedPosition, result.value.sketchId);
        return { ok: true, revisionId: result.value.revisionId };
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
        if (rejection) {
          const invalidatedReference = result.value.diagnostics?.find(
            (diagnostic) =>
              diagnostic.code === "occ-invalid-reference" && diagnostic.target !== null,
          )?.target;
          const selector = materializer.directSelectorForInvalidatedReference(
            invalidatedReference,
          );
          if (selector) {
            throw new TopologyApplyRematchError(
              selector,
              `the exact public-id binding ${describeRefusedTarget(invalidatedReference)} was invalidated during the rebuild`,
            );
          }
          return { ok: false, message: rejection };
        }
      }
      if (result.isOk()) {
        materializer.invalidateLiveSignatures();
        materializer.recordFeatureOutput(orderedPosition, result.value.featureId);
        const changedBodyIds = (result.value.changedTargets ?? []).flatMap((target) =>
          target.kind === "body" ? [target.bodyId] : [],
        );
        materializer.recordBodyOutput(orderedPosition, changedBodyIds);
        const constructionIds = (result.value.changedTargets ?? []).flatMap(
          (target) =>
            target.kind === "construction" ? [target.constructionId] : [],
        );
        if (constructionIds.length > 0) {
          materializer.recordConstructionOutput(orderedPosition, constructionIds);
        }
        return { ok: true, revisionId: result.value.revisionId };
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
function topologyApplyRematchDiagnostic(
  error: import("@/domain/import/orchestrator").TopologyApplyRematchError,
  orderedPosition: number,
): HistoryProbeStepDiagnostic {
  const target = `${error.selector.source.consumerFeatureId}:${error.selector.source.parameterId}:${error.selector.source.deterministicId}`;
  return {
    severity: "error",
    code: "topology-apply-rematch-failed",
    message: [
      `History probe topology rematch failed at step ${orderedPosition + 1} for ${target}`,
      error.detail,
    ]
      .filter((part): part is string => Boolean(part))
      .join(": "),
  };
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
