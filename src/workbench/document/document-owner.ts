import type { ImportSessionState } from "@/domain/editor/state-machine";
import type {
  DocumentHistoryOrderEntry,
  WorkspaceSnapshot,
  DocumentVariableRecord,
  ModelingDiagnostic,
} from "@/contracts/modeling/schema";
import type { FeatureId, RequestId } from "@/contracts/shared/ids";
import {
  describeUnknownError,
  ok,
  type AppErrorContextEntry,
  type AppResult,
} from "@/contracts/errors";
import {
  applyImportPreparedActions,
  createImportCapabilities,
  prepareImportActions,
  } from "@/domain/import/orchestrator";
import { createBrowserOccImportHistoryProbe } from "@/infrastructure/occ/browser-import-history-probe";
import { isDurablePrimitiveRef, type PrimitiveRef } from "@/core/editor/schema";
import { requireAcceptedModelingResult } from "@/lib/reported-action";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import type { GeometryAssetStore } from "@/domain/modeling/geometry-asset-store";
import type { ImportHistoryProbeCapabilities } from "@/contracts/import/capabilities";
import type { RuntimeExtensionRegistryComposition } from "@/domain/extensions/runtime-registry-composition";
import type { EditorEvent, EditorState } from "@/domain/editor/state-machine";

type VariablePatch = Pick<DocumentVariableRecord, "name" | "valueText">;

interface AcceptedMutationOptions {
  operation: string;
  fallbackMessage: string;
  context?: readonly AppErrorContextEntry[];
}

type AcceptedDocumentMutation<T> = AppResult<{
  mutation: T;
  snapshot: WorkspaceSnapshot;
}>;

interface WorkbenchDocumentOwnerDependencies {
  machineState: EditorState;
  dispatch: (event: EditorEvent) => void;
  modelingService: ModelingService;
  runtimeExtensionRegistries: Pick<
    RuntimeExtensionRegistryComposition,
    "importProviders"
  >;
  /**
   * App-level geometry asset store shared with the kernel resolver so baked
   * import bytes are the same bytes the kernel materializes. Omitted in tests,
   * where the import capability falls back to an in-memory store.
   */
  geometryAssetStore?: GeometryAssetStore;
  /** History probe factory; overridable in tests. */
  createImportHistoryProbe?: () => ImportHistoryProbeCapabilities;
}

function createWorkbenchRequestId(scope: string) {
  return `request_workbench_${scope}_${Date.now().toString(36)}` as RequestId;
}

export function createWorkbenchDocumentOwner({
  machineState,
  dispatch,
  modelingService,
  runtimeExtensionRegistries,
  geometryAssetStore,
  createImportHistoryProbe = createBrowserOccImportHistoryProbe,
}: WorkbenchDocumentOwnerDependencies) {
  const snapshot = machineState.snapshot;

  async function loadAcceptedMutationSnapshot() {
    const nextSnapshot = await modelingService.getCurrentDocumentSnapshot();
    dispatch({ type: "document.snapshotLoaded", snapshot: nextSnapshot });
    return nextSnapshot;
  }

  async function replaceActiveDocumentBasis() {
    const nextSnapshot = await modelingService.getCurrentDocumentSnapshot();
    dispatch({ type: "document.replaced", snapshot: nextSnapshot });
    return nextSnapshot;
  }

  function requireSnapshot() {
    if (!snapshot) {
      throw new Error("The current document is still loading.");
    }

    return snapshot;
  }

  async function acceptMutation<
    T extends {
      revisionState:
        | { kind: "accepted" }
        | { kind: "conflict"; actualRevisionId: string }
        | { kind: "rejected"; reasonCode: string };
      diagnostics: readonly ModelingDiagnostic[];
    },
  >(
    result: AppResult<T>,
    options: AcceptedMutationOptions,
  ): Promise<AcceptedDocumentMutation<T>> {
    if (result.isErr()) {
      return result as unknown as AcceptedDocumentMutation<T>;
    }

    const accepted = requireAcceptedModelingResult(result.value, options);
    if (accepted.isErr()) {
      if (result.value.revisionState.kind === "accepted") {
        await loadAcceptedMutationSnapshot();
      }
      return accepted as unknown as AcceptedDocumentMutation<T>;
    }

    return ok({
      mutation: accepted.value,
      snapshot: await loadAcceptedMutationSnapshot(),
    });
  }

  async function addDocumentVariable(options: AcceptedMutationOptions) {
    const currentSnapshot = requireSnapshot();
    const result = await modelingService.addDocumentVariable({
      baseRevisionId: currentSnapshot.document.revisionId,
      name: `var${currentSnapshot.document.variables.length + 1}`,
      valueText: "0",
    });

    return acceptMutation(result, options);
  }

  async function updateDocumentVariable(
    variableId: DocumentVariableRecord["variableId"],
    next: VariablePatch,
    options: AcceptedMutationOptions,
  ) {
    requireSnapshot();
    const currentSnapshot = await modelingService.getCurrentDocumentSnapshot();
    const result = await modelingService.updateDocumentVariable({
      baseRevisionId: currentSnapshot.document.revisionId,
      variableId,
      name: next.name,
      valueText: next.valueText,
    });

    return acceptMutation(result, options);
  }

  async function reorderDocumentHistory(
    item: DocumentHistoryOrderEntry,
    beforeItem: DocumentHistoryOrderEntry | null,
    options: AcceptedMutationOptions,
  ) {
    const currentSnapshot = requireSnapshot();
    const result = await modelingService.reorderDocumentHistory({
      baseRevisionId: currentSnapshot.document.revisionId,
      item,
      beforeItem,
    });

    return acceptMutation(result, options);
  }

  async function deleteTarget(
    target: PrimitiveRef,
    options: AcceptedMutationOptions,
  ) {
    if (!isDurablePrimitiveRef(target)) {
      throw new Error("Only durable document targets can be deleted.");
    }

    const currentSnapshot = requireSnapshot();
    const result = await modelingService.deleteTarget({
      baseRevisionId: currentSnapshot.document.revisionId,
      target,
    });

    return acceptMutation(result, options);
  }

  async function setFeatureSuppression(
    featureId: FeatureId,
    suppressed: boolean,
    options: AcceptedMutationOptions,
  ) {
    const currentSnapshot = requireSnapshot();
    const result = await modelingService.setFeatureSuppression({
      baseRevisionId: currentSnapshot.document.revisionId,
      featureId,
      suppressed,
    });

    return acceptMutation(result, options);
  }

  async function renameDocument(
    name: string,
    _options: Pick<
      AcceptedMutationOptions,
      "fallbackMessage" | "operation" | "context"
    >,
  ) {
    const result = await modelingService.renameDocument({ name });
    if (!result.ok) {
      return result;
    }

    return ok({
      mutation: result,
      snapshot: await loadAcceptedMutationSnapshot(),
    });
  }

  async function renameTarget(
    target: PrimitiveRef,
    nextLabel: string,
    options: AcceptedMutationOptions,
  ) {
    const currentSnapshot = requireSnapshot();

    switch (target.kind) {
      case "body": {
        const result = await modelingService.renameBody({
          baseRevisionId: currentSnapshot.document.revisionId,
          bodyId: target.bodyId,
          bodyLabel: nextLabel,
        });
        return acceptMutation(result, options);
      }
      case "feature": {
        const feature = currentSnapshot.document.features.find(
          (entry) => entry.featureId === target.featureId,
        );
        if (!feature) {
          throw new Error(`Could not find ${target.featureId}.`);
        }

        const result = await modelingService.updateFeature({
          baseRevisionId: currentSnapshot.document.revisionId,
          featureId: feature.featureId,
          featureLabel: nextLabel,
          definition: feature.definition,
        });
        return acceptMutation(result, options);
      }
      case "sketch": {
        const sketch = currentSnapshot.document.sketches.find(
          (entry) => entry.sketchId === target.sketchId,
        );
        if (!sketch) {
          throw new Error(`Could not find ${target.sketchId}.`);
        }

        const requestId = createWorkbenchRequestId("rename-sketch");
        const result = await modelingService.commitSketch({
          baseRevisionId: currentSnapshot.document.revisionId,
          sketchId: sketch.sketchId,
          sketchLabel: nextLabel,
          plane: sketch.plane,
          definition: sketch.sketch.definition,
          solverCorrelation:
            modelingService.sketchSolver?.createCommitCorrelation(requestId) ??
            null,
        });
        return acceptMutation(result, options);
      }
      default:
        throw new Error("Only sketches, features, and bodies can be renamed.");
    }
  }

  async function commitPartImport(
    activeImportSession: ImportSessionState,
    options?: {
      /** Reverts the last N committed operations to keep the import atomic. */
      rollback?: (appliedOperationCount: number) => Promise<void>;
    },
  ) {
    type ImportCommitStage = "prepare" | "apply" | "post-commit-handoff";
    let stage: ImportCommitStage = "prepare";

    try {
      const currentSnapshot = requireSnapshot();
      const provider = runtimeExtensionRegistries.importProviders.getById(
        activeImportSession.providerId,
      );
      if (!provider) {
        throw new Error("The selected import provider is no longer registered.");
      }

      const capabilities = createImportCapabilities(
        modelingService,
        currentSnapshot,
        {
          history: createImportHistoryProbe(),
          ...(geometryAssetStore ? { assetStore: geometryAssetStore } : {}),
        },
      );
      const actions = await prepareImportActions({
        provider,
        source: activeImportSession.resolvedSource,
        review: activeImportSession.review,
        selections: activeImportSession.selections,
        capabilities,
      });

      stage = "apply";
      const result = await applyImportPreparedActions({
        modelingService,
        baseRevisionId: currentSnapshot.document.revisionId,
        actions,
        rollback: options?.rollback,
      });

      if (
        result.diagnostics.some((diagnostic) => diagnostic.severity === "error")
      ) {
        // Reconcile after a failed import with committed work. A failed or absent
        // rollback may leave partial state; retaining the old snapshot would be
        // less honest than refreshing it. Reconciliation is supplementary: it
        // must not replace the original apply/rollback diagnostics.
        let snapshot: WorkspaceSnapshot | undefined;
        let failureDiagnostics = result.diagnostics;
        if (result.appliedOperationCount > 0) {
          try {
            snapshot = await replaceActiveDocumentBasis();
          } catch (error) {
            failureDiagnostics = [
              ...failureDiagnostics,
              {
                code: "import-reconciliation-failed",
                severity: "error",
                message: `Import reconciliation after rollback failed: ${describeUnknownError(
                  error,
                  "Snapshot reconciliation failed.",
                )}`,
                target: null,
                detail: null,
              },
            ];
          }
        }
        return {
          ok: false as const,
          diagnostics: failureDiagnostics,
          rolledBack: result.rolledBack,
          ...(snapshot ? { snapshot } : {}),
        };
      }

      stage = "post-commit-handoff";
      return {
        ok: true as const,
        createdEntityIds: result.createdEntityIds,
        snapshot: await loadAcceptedMutationSnapshot(),
      };
    } catch (error) {
      // This boundary owns the import session. Convert every thrown prepare,
      // apply, and post-commit handoff failure into its visible diagnostics so
      // callers never have to replace a useful error with a generic toast.
      return {
        ok: false as const,
        diagnostics: [
          {
            code: `import-${stage}-failed`,
            severity: "error" as const,
            message: describeUnknownError(error, "Import failed."),
            target: null,
            detail: null,
          },
        ],
        rolledBack: false,
      };
    }
  }

  return {
    addDocumentVariable,
    commitPartImport,
    deleteTarget,
    renameDocument,
    reorderDocumentHistory,
    renameTarget,
    replaceActiveDocumentBasis,
    setFeatureSuppression,
    updateDocumentVariable,
  };
}
