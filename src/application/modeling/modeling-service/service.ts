import { enrichExtrudeRegionProfiles } from "@/core/modeling/region-profile-selection";
import { createLoadingStatus } from "@/contracts/modeling/loading-status";
import { requireMeasureTopologyResponse } from "@/contracts/modeling/topology-measure.runtime-schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { appErrorFromModelingDiagnostic } from "@/contracts/errors/app-error";
import type {
  AuthoredDocumentRestoreOptions,
  GeometryAssetResolver,
  ModelingKernelAdapter,
} from "@/contracts/modeling/adapter";
import type { DocumentExportResult } from "@/contracts/modeling/export";
import type { OccNativeExactBrepPayload } from "@/contracts/modeling/kernel-payloads";
import type { OccNativeTopologyWorkerResult } from "@/contracts/modeling/kernel-worker-result";
import type { OccTessellationTierId } from "@/contracts/modeling/tessellation";
import { orchestrateGeometryExport } from "@/application/export/export-orchestrator";
import { createExportProviderRegistry } from "@/core/export/provider-registry";
import type { PrimitiveRef, RevisionId } from "@/core/editor/schema";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import type {
  GetDocumentSnapshotResponse,
  WorkspaceSnapshot,
  ModelingDiagnostic,
  ModelingOperationResult,
  MutationRevisionState,
  RebuildResult,
} from "@/contracts/modeling/schema";
import type {
  GeometryAssetBlobInput,
  GeometryAssetHash,
} from "@/contracts/modeling/geometry-assets";
import {
  encodeGeometryAssetData,
  getEmbeddedGeometryAssetBytes,
  createGeometryAssetDiagnostic,
} from "@/contracts/modeling/geometry-assets";
import { requireCadaraExportOptions } from "@/contracts/modeling/export.runtime-schema";
import {
  createAuthoredModelDocumentFromSnapshot,
  type AuthoredModelDocument,
} from "@/contracts/modeling/authored-document";
import {
  authoredModelDocumentsEqual,
  classifyAuthoredModelDocumentChange,
} from "@/contracts/modeling/authored-document-equality";
import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";
import {
  createCommitSketchHistoryEntry,
  createAddDocumentVariableHistoryEntry,
  createCreateFeatureHistoryEntry,
  createDeleteFeatureHistoryEntry,
  createDeleteTargetHistoryEntry,
  createEmptyOperationHistory,
  createRenameBodyHistoryEntry,
  createSetBodyAppearanceHistoryEntry,
  createReorderDocumentHistoryEntry,
  createReorderFeatureHistoryEntry,
  createSetFeatureCursorHistoryEntry,
  createSetFeatureSuppressionHistoryEntry,
  createUpdateDocumentVariableHistoryEntry,
  createRemoveDocumentVariableHistoryEntry,
  createUpdateFeatureHistoryEntry,
  type ModelingOperationHistoryEntry,
  type ModelingOperationHistoryPayload,
} from "@/contracts/modeling/operation-history";
import type { ProjectSketchExternalReferencesRequest } from "@/contracts/solver/schema";
import { loadOrCreateOperationHistory } from "@/application/modeling/modeling-history-persistence";
import { isLocalFileSyncDocumentRepository, isGeometryAssetDocumentRepository } from "@/core/modeling/document-repository";
import { type DocumentRepositoryChangeEvent, type DocumentRepositoryMetadata, type DocumentRepositoryMutationResult, type DocumentRepositoryRestoreStatus } from "@/contracts/modeling/document-repository";
import { serializeAuthoredDocumentJson as createLocalAuthoredDocumentPayload } from "@/contracts/modeling/authored-document-serialization";
import { hashGeometryAssetBytes } from "@/core/modeling/geometry-asset-store";
import type {
  LocalSaveFailure,
  LocalSaveStatus,
  ModelingService,
  ModelingServiceOptions,
  ModelingServiceDocumentChangeEvent,
  ModelingHistoryRestoreState,
  ModelingDocumentFileMutationResult,
} from "./types";
import { createSketchSolverService } from "./sketch-solver";
import {
  withContractVersion,
  sameStringSet,
  collectMissingFeatureSketchDependencyIds,
  normalizeCurrentDocumentId,
  normalizeCommitSketchInput,
  normalizeAddDocumentVariableInput,
  normalizeUpdateDocumentVariableInput,
  normalizeRemoveDocumentVariableInput,
  normalizeCreateFeatureInput,
  normalizeUpdateFeatureInput,
  normalizeDeleteFeatureInput,
  normalizeDeleteTargetInput,
  normalizeRelabelInput,
  normalizeRenameBodyInput,
  normalizeSetBodyAppearanceInput,
  normalizeReorderFeatureInput,
  normalizeReorderDocumentHistoryInput,
  normalizeSetFeatureCursorInput,
  normalizeSetFeatureSuppressionInput,
  normalizePreviewInput,
  normalizeResolveReferenceInput,
  normalizeExportDocumentInput,
  isAcceptedMutation,
  createRestoreFailure,
  createRepositoryRestoreFailure,
  createDocumentRepositoryDiagnostic,
  runModelingMutationBoundary,
  type ModelingMutationBoundaryResult,
  getResolutionLabel,
  createExportDiagnostic,
  createExportFilename,
  stringifyCadaraDocument,
} from "./helpers";
import {
  validateSnapshotResponse,
  buildDocumentRequest,
  mapCommitSketchResponse,
  mapDocumentVariableResponse,
  mapFeatureMutationResponse,
  mapFeatureSuppressionResponse,
  mapDeleteFeatureResponse,
  mapDeleteTargetResponse,
  mapRenameBodyResponse,
  mapSetBodyAppearanceResponse,
  mapReorderFeatureResponse,
  mapReorderDocumentHistoryResponse,
  mapSetFeatureCursorResponse,
  mapPreviewResponse,
  mapExportDocumentResponse,
  mapResolvedReferenceResponse,
} from "./snapshot";
import {
  getAdapterReplayCursor,
  replayHistoryEntry,
} from "./operation-history";
import { createRevisionId, parseRevisionSequence } from "../../../core/modeling/document-revision";

/** A feature kind as a history label. */
function featureKindLabel(kind: string) {
  return kind.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
}

interface SaveFailureReason {
  reasonCode: string;
  message: string;
}

const STORAGE_UNAVAILABLE: SaveFailureReason = {
  reasonCode: "document-storage-unavailable",
  message: "Document storage is unavailable.",
};

function isSameLocalSaveFailure(
  a: LocalSaveFailure | null,
  b: LocalSaveFailure | null,
) {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.target === b.target &&
      a.reasonCode === b.reasonCode &&
      a.message === b.message)
  );
}

export function createModelingService(
  adapter: ModelingKernelAdapter,
  options: ModelingServiceOptions,
): ModelingService {
  const exportProviders =
    options.exportProviders ?? createExportProviderRegistry([]);
  const currentDocumentId = normalizeCurrentDocumentId(
    options.currentDocumentId,
  );
  const sketchSolver = options.sketchSolver
    ? createSketchSolverService(options.sketchSolver)
    : null;
  const operationHistoryStore = options.operationHistoryStore ?? null;
  const documentRepository = options.documentRepository ?? null;
  const initialLoadingStatus = createLoadingStatus(
    documentRepository || operationHistoryStore
      ? "opening-document"
      : "preparing-geometry",
  );
  const documentRepositoryPersistence =
    options.documentRepositoryPersistence ?? "blocking";
  let operationHistoryPayload: ModelingOperationHistoryPayload =
    createEmptyOperationHistory(currentDocumentId);
  let canPersistOperationHistory = true;
  let canPersistAuthoredDocument = true;
  /** No canonical stored basis was adopted; provisional kernel state is not editable. */
  let initialRepositoryLoadFailure: Extract<DocumentRepositoryRestoreStatus, { kind: "failed" }> | null = null;
  /** Why an accepted local change exists in memory only (cadara-vk96). */
  let unsavedLocalChange: SaveFailureReason | null = null;
  let historyRestoreState: ModelingHistoryRestoreState = {
    kind: "pending",
    entriesReplayed: 0,
    diagnostics: [],
  };
  let currentRepositoryMetadata: DocumentRepositoryMetadata | null = null;
  let latestDocumentChangeEvent: ModelingServiceDocumentChangeEvent | null =
    null;
  let seedAuthoredDocument: AuthoredModelDocument | null = null;
  let restoredMutationPredecessor: { document: AuthoredModelDocument; runtimeRevisionId: RevisionId } | null = null;
  let repositorySnapshotBasis: {
    runtimeRevisionId: RevisionId;
    repositoryRevisionId: RevisionId;
    metadata: DocumentRepositoryMetadata;
  } | null = null;
  let stateGeneration = 0;
  let runtimeGeneration = 0;

  function beginRuntimeChange() {
    repositorySnapshotBasis = null;
    stateGeneration += 1;
    return ++runtimeGeneration;
  }
  let repositoryChangePromise = Promise.resolve();
  let repositoryRestoreFailure: {
    error: unknown;
    previousHistoryState: ModelingHistoryRestoreState;
  } | null = null;
  let pendingPublicationRestore: (() => Promise<void>) | null = null;
  let publicationRecovery: Promise<void> | null = null;

  async function recoverPublishedDocument() {
    const restore = pendingPublicationRestore;
    if (!restore) return;
    // Concurrent snapshot readers share the handoff; a rejection remains retryable.
    publicationRecovery ??= restore().then(() => {
      if (pendingPublicationRestore === restore) pendingPublicationRestore = null;
    }).finally(() => { publicationRecovery = null; });
    await publicationRecovery;
  }
  let repositoryPersistencePromise = Promise.resolve();
  // T17k3 (A-1): local mutations in flight, and the newest repository state seen.
  let localMutations: Promise<unknown> = Promise.resolve();
  // cadara-8p7o: local mutations and repository writes still running, and
  // whether the bound local file is being written.
  let runningLocalSaves = 0;
  let localFileWriting = false;
  let localFileWriteFailure: SaveFailureReason | null = null;
  let localSaveStatus: LocalSaveStatus = { saving: false, failure: null };
  const localSaveStatusListeners = new Set<() => void>();
  // The sync worker reports a bound file write as syncing before it answers
  // the repository write that queued it, so saving has no gap between them.
  const unsubscribeLocalFileWrites = isLocalFileSyncDocumentRepository(
    documentRepository,
  )
    ? documentRepository.subscribeToLocalFileSyncStatus((status) => {
        if (status.documentId !== currentDocumentId) return;
        localFileWriting = status.kind === "syncing";
        if (status.kind === "failed" || status.kind === "permission-denied") {
          localFileWriteFailure = {
            reasonCode: `local-file-${status.kind}`,
            message: status.message,
          };
        } else if (status.kind === "synced" || status.kind === "idle") {
          localFileWriteFailure = null;
        }
        publishLocalSaveStatus();
      })
    : undefined;
  let latestRepositoryEvent: DocumentRepositoryChangeEvent | null = null;
  let restoredRepositoryEvent: DocumentRepositoryChangeEvent | null = null;
  let isRestoringRepositoryDocument = documentRepository !== null;
  let repositoryLoadSettled = false;
  let disposed = false;
  let adapterDisposed = false;
  /** The viewport's tier; the adapter's snapshots start at "startup". */
  let requestedViewportLodTierId: OccTessellationTierId = "startup";
  let displayedViewportLodTierId: OccTessellationTierId = "startup";
  let initializationSettled = false;
  let initializationPromise: Promise<void> | null = null;
  let unsubscribeDocumentRepository: (() => void) | undefined;
  const documentChangeListeners = new Set<
    (event: ModelingServiceDocumentChangeEvent) => void
  >();

  function rememberRepositoryMetadata(metadata: DocumentRepositoryMetadata) {
    stateGeneration += 1;
    currentRepositoryMetadata = {
      ...metadata,
      heads: [...metadata.heads],
    };
  }

  function markRepositorySnapshotFresh(
    metadata: DocumentRepositoryMetadata,
    document?: AuthoredModelDocument,
    runtimeRevisionId = document?.revisionId,
  ) {
    rememberRepositoryMetadata(metadata);
    if (document && runtimeRevisionId) {
      repositorySnapshotBasis = {
        runtimeRevisionId,
        repositoryRevisionId: document.revisionId,
        metadata: { ...metadata, heads: [...metadata.heads] },
      };
    }
  }

  function createEmptyOperationHistoryForCurrentRepository() {
    return createEmptyOperationHistory(
      currentDocumentId,
      currentRepositoryMetadata?.heads,
    );
  }

  function resetOperationHistoryPayloadForCurrentRepository() {
    operationHistoryPayload = createEmptyOperationHistoryForCurrentRepository();
  }

  function canReplayOperationHistoryOverRestoredRepository(
    historyPayload: ModelingOperationHistoryPayload,
    restoredDocument: AuthoredModelDocument,
    seedDocument: AuthoredModelDocument,
    restoredMetadata: DocumentRepositoryMetadata,
  ) {
    return (
      authoredDocumentsEqual(restoredDocument, seedDocument) ||
      (historyPayload.baseRepositoryHeads !== undefined &&
        sameStringSet(
          historyPayload.baseRepositoryHeads,
          restoredMetadata.heads,
        )) ||
      canOperationHistoryRepairMissingSketchDependencies(
        historyPayload,
        restoredDocument,
      )
    );
  }

  function canOperationHistoryRepairMissingSketchDependencies(
    historyPayload: ModelingOperationHistoryPayload,
    restoredDocument: AuthoredModelDocument,
  ) {
    const missingSketchIds =
      collectMissingFeatureSketchDependencyIds(restoredDocument);
    if (missingSketchIds.size === 0) {
      return false;
    }

    const replayedSketchIds = new Set(
      historyPayload.entries
        .filter(
          (
            entry,
          ): entry is Extract<
            ModelingOperationHistoryEntry,
            { kind: "commitSketch" }
          > => entry.kind === "commitSketch",
        )
        .map((entry) => entry.payload.sketchId),
    );

    return [...missingSketchIds].every((sketchId) =>
      replayedSketchIds.has(sketchId),
    );
  }

  function attachRepositoryProvenance(
    snapshot: WorkspaceSnapshot,
  ): WorkspaceSnapshot {
    const basis = repositorySnapshotBasis;
    if (!documentRepository || !basis || basis.runtimeRevisionId !== snapshot.document.revisionId) {
      return { ...snapshot, provenance: null };
    }
    return {
      ...snapshot,
      provenance: {
        actorId: basis.metadata.actorId,
        repositoryHeads: [...basis.metadata.heads],
        repositoryRevisionId: basis.repositoryRevisionId,
        repositorySource: basis.metadata.source,
      },
    };
  }

  function repositoryHeadsChangedSinceBasis(input: {
    baseRepositoryHeads?: readonly string[];
  }) {
    if (!currentRepositoryMetadata || !input.baseRepositoryHeads) {
      return false;
    }

    if (currentRepositoryMetadata.source !== "peer") {
      return false;
    }

    return !sameStringSet(
      currentRepositoryMetadata.heads,
      input.baseRepositoryHeads,
    );
  }

  function addRepositoryFreshnessDiagnostic<
    T extends {
      revisionState: MutationRevisionState;
      diagnostics: ModelingDiagnostic[];
    },
  >(result: T, input: { baseRepositoryHeads?: readonly string[] }): T {
    if (!repositoryHeadsChangedSinceBasis(input)) {
      return result;
    }

    return {
      ...result,
      diagnostics: [
        ...result.diagnostics,
        {
          code: "repository-head-conflict",
          severity: "error",
          message:
            "The authored document changed after the current snapshot was loaded. Refresh before retrying this mutation.",
          target: null,
          detail: null,
        },
      ],
    };
  }

  async function restoreAuthoredRepositoryDocument(
    document: Parameters<
      NonNullable<ModelingKernelAdapter["restoreAuthoredModelDocument"]>
    >[0],
    diagnostics: ModelingDiagnostic[] = [],
    assets: readonly GeometryAssetBlobInput[] = [],
    options?: AuthoredDocumentRestoreOptions,
    metadata?: DocumentRepositoryMetadata,
  ) {
    const generation = beginRuntimeChange();
    restoredMutationPredecessor = null;
    if (!adapter.restoreAuthoredModelDocument) {
      throw new Error("The active modeling adapter cannot restore authored repository documents.");
    }
    await adapter.restoreAuthoredModelDocument(
      document,
      diagnostics,
      createLocalAssetResolver(document, assets),
      options,
    );
    const runtimeRevisionId = await currentRevisionId();
    // A later runtime operation cannot supply evidence for this restore.
    if (generation !== runtimeGeneration) return;
    restoredMutationPredecessor = { document: structuredClone(document), runtimeRevisionId };
    if (metadata) markRepositorySnapshotFresh(metadata, document, runtimeRevisionId);
  }

  /** T17k3 (K3): the repository's current state, which may hold changes this
   * session did not author (peer writes, Undo/Redo). Its stored revision id is
   * not an identity for it, so the kernel gives it a new one. */
  function restoreRepositoryState(
    document: AuthoredModelDocument,
    diagnostics: ModelingDiagnostic[] = [],
    metadata?: DocumentRepositoryMetadata,
  ) {
    return restoreAuthoredRepositoryDocument(document, diagnostics, [], {
      newRevision: true,
    }, metadata);
  }

  /** cadara-xkg, cadara-kv69: an Undo/Redo whose state differs from the
   * runtime's `current` export only in the document name, feature or sketch
   * labels, or body labels or colours is applied through the kernel's rename
   * and appearance operations, which re-run no feature. Any other difference,
   * or an operation the kernel refuses, restores the whole document. Each
   * operation allocates the next unused revision; a peer state keeps the full
   * restore, which adopts its stored revision id when that is later than
   * every id used here. */
  async function adoptRepositoryState(
    current: AuthoredModelDocument,
    event: DocumentRepositoryChangeEvent,
  ) {
    const change = event.metadata.source === "undo" || event.metadata.source === "redo"
      ? classifyAuthoredModelDocumentChange(current, event.document)
      : null;
    if (change?.kind !== "metadata" || event.diagnostics?.length) {
      return restoreRepositoryState(event.document, event.diagnostics, event.metadata);
    }
    const { name } = change;
    const operations: ((baseRevisionId: RevisionId) => Promise<ModelingOperationResult>)[] = [
      ...(name === null ? [] : [(baseRevisionId: RevisionId) =>
        adapter.renameDocument({
          ...buildDocumentRequest(currentDocumentId),
          baseRevisionId,
          name,
        })]),
      ...change.featureLabels.map(({ featureId, label }) => (baseRevisionId: RevisionId) =>
        adapter.renameFeature(normalizeRelabelInput(
          { baseRevisionId, featureId, featureLabel: label },
          currentDocumentId,
        ))),
      ...change.sketchLabels.map(({ sketchId, label }) => (baseRevisionId: RevisionId) =>
        adapter.renameSketch(normalizeRelabelInput(
          { baseRevisionId, sketchId, sketchLabel: label },
          currentDocumentId,
        ))),
      ...change.bodyLabels.map(({ bodyId, label }) => (baseRevisionId: RevisionId) =>
        adapter.renameBody(normalizeRenameBodyInput(
          { baseRevisionId, bodyId, bodyLabel: label },
          currentDocumentId,
        ))),
      ...change.bodyAppearances.map(({ bodyId, appearance }) => (baseRevisionId: RevisionId) =>
        adapter.setBodyAppearance(normalizeSetBodyAppearanceInput(
          { baseRevisionId, bodyId, appearance },
          currentDocumentId,
        ))),
    ];
    const generation = beginRuntimeChange();
    restoredMutationPredecessor = null;
    let runtimeRevisionId = current.revisionId;
    for (const operation of operations) {
      const response = await operation(runtimeRevisionId);
      if (!isAcceptedMutation(response)) {
        return restoreRepositoryState(event.document, event.diagnostics, event.metadata);
      }
      runtimeRevisionId = response.revisionId;
    }
    // A later runtime operation cannot supply evidence for this state.
    if (generation !== runtimeGeneration) return;
    restoredMutationPredecessor = { document: structuredClone(event.document), runtimeRevisionId };
    markRepositorySnapshotFresh(event.metadata, event.document, runtimeRevisionId);
  }

  /** T17k3 (A-1): a document mutation runs after the repository changes
   * received before it; a change received during it is restored after it. */
  function runLocalDocumentChange<T>(
    action: () => Promise<T>,
    replaceContext = false,
    countsAsSaving = true,
  ) {
    const changesBefore = repositoryChangePromise;
    const mutationsBefore = localMutations;
    const run = (async () => {
      await ensureInitialized();
      await waitForRepositoryChanges(changesBefore);
      await mutationsBefore;
      // A new editing context must not be overwritten by an older queued write.
      if (replaceContext) await repositoryPersistencePromise;
      await recoverPublishedDocument();
      return action();
    })();
    // Ordering only: the caller still receives `run`'s rejection.
    localMutations = run.catch(() => undefined);
    if (countsAsSaving) trackLocalSave(localMutations);
    return run;
  }

  /** `localMutations` never rejects. */
  async function waitForLocalMutations() {
    await localMutations;
  }

  /** Publishes a new status object only when the state changed. */
  function publishLocalSaveStatus() {
    const saving = runningLocalSaves > 0 || localFileWriting;
    // An edit only in memory outweighs a stale bound file.
    const reason = unsavedLocalChange ?? localFileWriteFailure;
    const failure: LocalSaveFailure | null = reason && {
      documentId: currentDocumentId,
      target: unsavedLocalChange ? "repository" : "local-file",
      reasonCode: reason.reasonCode,
      message: reason.message,
    };
    const sameFailure = isSameLocalSaveFailure(failure, localSaveStatus.failure);
    if (saving === localSaveStatus.saving && sameFailure) return;
    // An unchanged failure keeps its identity: consumers report it once.
    localSaveStatus = { saving, failure: sameFailure ? localSaveStatus.failure : failure };
    for (const listener of localSaveStatusListeners) listener();
  }

  /** `work` must not reject: it marks saving from now until it settles. */
  function trackLocalSave(work: Promise<unknown>) {
    runningLocalSaves += 1;
    publishLocalSaveStatus();
    void work.then(() => {
      runningLocalSaves -= 1;
      publishLocalSaveStatus();
    });
  }

  async function waitForRepositoryChanges(changes = repositoryChangePromise) {
    await changes;
    // Never read or mutate an incomplete runtime, even if no new peer has
    // arrived yet. The next repository event can retry without this rejection.
    if (repositoryRestoreFailure) throw repositoryRestoreFailure.error;
  }

  function runLocalMutation<T extends ModelingMutationBoundaryResult>(
    input: Parameters<typeof runModelingMutationBoundary<T>>[0],
  ) {
    return runModelingMutationBoundary<T>({
      ...input,
      action: () => runLocalDocumentChange(() => {
        if (initialRepositoryLoadFailure)
          throw appErrorFromModelingDiagnostic(
            createDocumentRepositoryDiagnostic(initialRepositoryLoadFailure),
            { operation: input.operation, requestId: input.requestId },
          );
        return applyLocalMutation(input.action);
      }),
    });
  }

  /** Runs one kernel mutation inside a local document change. */
  async function applyLocalMutation<T extends ModelingMutationBoundaryResult>(
    action: () => Promise<T>,
  ) {
    const previousBasis = repositorySnapshotBasis;
    const previousExport = lastPersistedRuntimeExport?.runtimeGeneration === runtimeGeneration
      ? lastPersistedRuntimeExport : null;
    const generation = beginRuntimeChange();
    // The kernel operation has not run yet: until it does, the previous
    // export still is this mutation's predecessor (cadara-13x).
    const predecessorExport = previousExport && { ...previousExport, runtimeGeneration: generation };
    lastPersistedRuntimeExport = predecessorExport;
    let result: T;
    try {
      result = await action();
    } finally {
      // Only an export taken after the kernel operation describes it.
      if (lastPersistedRuntimeExport === predecessorExport) lastPersistedRuntimeExport = null;
    }
    // A refusal leaves the runtime untouched. Its previous verified basis
    // remains valid unless another runtime operation has intervened.
    if (result.revisionState.kind !== "accepted" && generation === runtimeGeneration && !repositorySnapshotBasis && previousBasis) {
      repositorySnapshotBasis = previousBasis;
      stateGeneration += 1;
    }
    return result;
  }

  async function currentRevisionId() {
    return validateSnapshotResponse(
      await adapter.getDocumentSnapshot(
        buildDocumentRequest(currentDocumentId),
      ),
      currentDocumentId,
    ).document.revisionId;
  }

  async function getSeedAuthoredDocument() {
    if (seedAuthoredDocument) {
      return structuredClone(seedAuthoredDocument);
    }

    const seedSnapshot = validateSnapshotResponse(
      await adapter.getDocumentSnapshot(
        buildDocumentRequest(currentDocumentId),
      ),
      currentDocumentId,
    );
    seedAuthoredDocument =
      createAuthoredModelDocumentFromSnapshot(seedSnapshot);
    return structuredClone(seedAuthoredDocument);
  }

  function authoredDocumentsEqual(
    left: AuthoredModelDocument,
    right: AuthoredModelDocument,
  ) {
    return authoredModelDocumentsEqual(left, right);
  }

  async function exportAuthoredDocumentForRepository() {
    if (adapter.exportAuthoredModelDocument) {
      return adapter.exportAuthoredModelDocument(currentDocumentId);
    }

    const snapshot = validateSnapshotResponse(
      await adapter.getDocumentSnapshot(
        buildDocumentRequest(currentDocumentId),
      ),
      currentDocumentId,
    );
    return createAuthoredModelDocumentFromSnapshot(snapshot);
  }

  /** cadara-13x: the authored document an accepted mutation exported for its
   * repository write. Every other runtime change advances `runtimeGeneration`,
   * so a matching generation means the runtime still holds exactly this export
   * and the next mutation reuses it as its predecessor instead of exporting
   * the whole document again. */
  let lastPersistedRuntimeExport: {
    document: AuthoredModelDocument;
    runtimeGeneration: number;
  } | null = null;

  async function exportAcceptedAuthoredDocument() {
    const document = await exportAuthoredDocumentForRepository();
    lastPersistedRuntimeExport = { document, runtimeGeneration };
    return document;
  }

  async function exportRuntimeDocument() {
    return lastPersistedRuntimeExport?.runtimeGeneration === runtimeGeneration
      ? structuredClone(lastPersistedRuntimeExport.document)
      : exportAuthoredDocumentForRepository();
  }

  async function getMutationPredecessor(kernelBase?: AuthoredModelDocument) {
    kernelBase ??= await exportRuntimeDocument();
    // Restore/compensation rebuilds native witnesses, while the repository keeps
    // its exact previous stored basis. That basis applies only until the runtime
    // advances: later writes may be queued ahead of background persistence.
    return restoredMutationPredecessor?.runtimeRevisionId === kernelBase.revisionId
      ? structuredClone(restoredMutationPredecessor.document)
      : kernelBase;
  }

  function createDocumentFileDiagnostic(
    code: string,
    message: string,
  ): ModelingDiagnostic {
    return {
      code,
      severity: "error",
      message,
      target: null,
      detail: null,
    };
  }

  function createLocalAssetResolver(
    document: AuthoredModelDocument,
    assets: readonly GeometryAssetBlobInput[],
  ): GeometryAssetResolver | undefined {
    const transientAssetBytesByHash = new Map<GeometryAssetHash, Uint8Array>();
    // Import validation restores before repository initialization; embedded native
    // inputs must be resolvable during that restore, not only after persistence.
    for (const asset of document.assets.records) {
      const bytes = getEmbeddedGeometryAssetBytes(asset);
      if (bytes) transientAssetBytesByHash.set(asset.hash, bytes);
    }
    const transientAssetsById = new Map(
      assets.map((asset) => {
        transientAssetBytesByHash.set(asset.asset.hash, asset.bytes.slice());
        return [asset.asset.assetId, asset] as const;
      }),
    );

    const repositoryResolver = isGeometryAssetDocumentRepository(
      documentRepository,
    )
      ? documentRepository
      : undefined;

    if (transientAssetBytesByHash.size === 0 && !repositoryResolver) {
      return undefined;
    }

    return {
      async resolveGeometryAsset(reference) {
        const transient = transientAssetsById.get(reference.assetId);
        if (transient) {
          return {
            bytes: transient.bytes.slice(),
            format: transient.asset.format,
          };
        }

        const record = document.assets.records.find(
          (asset) => asset.assetId === reference.assetId,
        );
        if (!record) return null;
        const bytes = transientAssetBytesByHash.get(record.hash) ??
          await repositoryResolver?.getGeometryAssetRecord(record);
        return bytes ? { bytes: bytes.slice(), format: record.format } : null;
      },
      async getGeometryAssetBytes(hash) {
        const bytes = transientAssetBytesByHash.get(hash);
        if (bytes) {
          return bytes.slice();
        }

        return repositoryResolver?.getGeometryAssetBytes(hash) ?? null;
      },
    };
  }

  async function validateEmbeddedGeometryAssetsForPersistence(
    document: AuthoredModelDocument,
    assets: readonly GeometryAssetBlobInput[],
  ) {
    const diagnostics: ModelingDiagnostic[] = [];
    const providedAssetsById = new Map(
      assets.map((asset) => [asset.asset.assetId, asset]),
    );

    // Current native files must carry the retained inputs they reference;
    // resolving an old session's store copy would make reopening non-repeatable.
    const manifestById = new Map(
      document.assets.records.map((asset) => [asset.assetId, asset]),
    );
    for (const feature of document.features) {
      if (feature.definition.kind !== "bakedBody") continue;
      const reference = feature.definition.parameters;
      const asset = manifestById.get(reference.assetId);
      if (
        !asset ||
        asset.format !== reference.format ||
        asset.hash !== reference.hash ||
        asset.byteLength !== reference.byteLength
      ) {
        diagnostics.push(
          {
            ...createDocumentFileDiagnostic(
              "document-import-asset-missing",
              `Retained geometry for ‘${feature.label || "Imported feature"}’ is missing or does not match its recorded input.`,
            ),
            target: { kind: "feature", featureId: feature.featureId },
          },
        );
      }
    }

    for (const asset of document.assets.records) {
      if (asset.format !== "cadara-brep" && asset.format !== "baked-mesh") {
        continue;
      }

      if (!asset.data) {
        diagnostics.push(
          createGeometryAssetDiagnostic(
            "geometry-asset-corrupt",
            asset,
            "Retained geometry is missing embedded authored geometry data.",
          ),
        );
        continue;
      }

      const embeddedBytes = encodeGeometryAssetData(asset.data);
      const embeddedHash = await hashGeometryAssetBytes(embeddedBytes);
      if (
        embeddedBytes.byteLength !== asset.byteLength ||
        embeddedHash !== asset.hash
      ) {
        diagnostics.push(
          createGeometryAssetDiagnostic(
            "geometry-asset-corrupt",
            asset,
            "Retained geometry does not match its recorded hash or byte length.",
          ),
        );
      }

      const providedAsset = providedAssetsById.get(asset.assetId);
      if (providedAsset) {
        const providedHash = await hashGeometryAssetBytes(providedAsset.bytes);
        if (
          providedAsset.asset.hash !== asset.hash ||
          providedAsset.asset.byteLength !== asset.byteLength ||
          providedAsset.bytes.byteLength !== asset.byteLength ||
          providedHash !== asset.hash
        ) {
          diagnostics.push(
            createGeometryAssetDiagnostic(
              "geometry-asset-corrupt",
              asset,
              "Prepared geometry does not match its embedded authored geometry data.",
            ),
          );
        }
      }
    }

    return diagnostics;
  }

  type AuthoredDocumentValidationResult =
    | { ok: true; document: AuthoredModelDocument }
    | { ok: false; diagnostics: ModelingDiagnostic[] };

  function normalizeImportedDocument(
    value: unknown,
  ): AuthoredDocumentValidationResult {
    const parsed = parseAuthoredModelDocument(structuredClone(value));

    if (!parsed.ok) {
      return {
        ok: false,
        diagnostics: [
          createDocumentFileDiagnostic(
            `document-import-${parsed.diagnostic.reasonCode}`,
            parsed.diagnostic.message,
          ),
        ],
      };
    }

    return {
      ok: true,
      document: {
        ...parsed.document,
        documentId: currentDocumentId,
      },
    };
  }

  async function replaceCurrentAuthoredDocument(
    document: AuthoredModelDocument,
    assets: readonly GeometryAssetBlobInput[] = [],
    options: {
      fetchSnapshot?: boolean;
      validateBeforePersist?: boolean;
      validateEmbeddedAssetsBeforePersist?: boolean;
      observeTransaction?: (transaction: import("@/contracts/modeling/document-repository").DocumentRepositoryMutationResult) => void;
      authoredAction?: { expected: AuthoredModelDocument; label: string };
    } = {},
  ): Promise<ModelingDocumentFileMutationResult> {
    if (!adapter.restoreAuthoredModelDocument) {
      return {
        ok: false,
        diagnostics: [
          createDocumentFileDiagnostic(
            "document-import-unsupported-adapter",
            "The active modeling adapter cannot restore authored documents.",
          ),
        ],
      };
    }

    const normalized = normalizeImportedDocument(document);
    if (!normalized.ok) {
      return normalized;
    }

    let activeDocument = normalized.document;
    let activeMetadata: DocumentRepositoryMetadata | undefined;
    let activeRuntimeRevisionId: RevisionId | undefined;
    const rollbackMetadata = currentRepositoryMetadata ?? undefined;
    let restoreDiagnostics: ModelingDiagnostic[] = [];
    const rollbackDocument =
      options.validateBeforePersist && documentRepository
        ? await exportAuthoredDocumentForRepository()
        : null;

    const restoreActiveDocument = async () => {
      await restoreAuthoredRepositoryDocument(
        activeDocument,
        restoreDiagnostics,
        assets,
        undefined,
        activeMetadata,
      );
    };

    const validateActiveDocument = async () => {
      beginRuntimeChange();
      await (adapter.validateAuthoredModelDocument?.(
        activeDocument,
        restoreDiagnostics,
        createLocalAssetResolver(activeDocument, assets),
      ) ?? restoreActiveDocument());
    };

    if (options.validateEmbeddedAssetsBeforePersist) {
      const diagnostics = await validateEmbeddedGeometryAssetsForPersistence(
        activeDocument,
        assets,
      );
      if (diagnostics.length > 0) return { ok: false, diagnostics };
    }

    if (options.validateBeforePersist) {
      try {
        await validateActiveDocument();
        // Restore regenerates runtime topology witnesses. Persist that actual
        // restored basis, not file-era tokens that the next write would
        // legitimately reject as different from its own runtime predecessor.
        const restored = await exportAuthoredDocumentForRepository();
        // A document saved before body colours keeps having none: opening it
        // must not write the kernel's auto slots (see `bodyAppearances`); the
        // next real authored action persists them against this basis.
        if (normalized.document.bodyAppearances === undefined) {
          delete restored.bodyAppearances;
        }
        activeDocument = restored;
        activeRuntimeRevisionId = activeDocument.revisionId;
      } catch (error: unknown) {
        return {
          ok: false,
          diagnostics: [
            createDocumentFileDiagnostic(
              "document-import-restore-failed",
              error instanceof Error
                ? error.message
                : "Imported document could not be restored.",
            ),
          ],
        };
      }
    }

    if (documentRepository) {
      const writeResult = options.authoredAction
        ? await documentRepository.mutate({
            documentId: currentDocumentId,
            document: activeDocument,
            expected: options.authoredAction.expected,
            label: options.authoredAction.label,
            assets,
          })
        : await documentRepository.initialize({
            documentId: currentDocumentId,
            document: activeDocument,
            assets,
          });

      options.observeTransaction?.(writeResult);
      if (!writeResult.ok) {
        canPersistAuthoredDocument = false;
        if (writeResult.appliedLive) {
          markRepositorySnapshotFresh(writeResult.appliedLive.metadata);
          await restoreAuthoredRepositoryDocument(writeResult.appliedLive.document, writeResult.appliedLive.diagnostics ?? [], assets, undefined, writeResult.appliedLive.metadata);
        } else if (rollbackDocument) {
          await restoreAuthoredRepositoryDocument(rollbackDocument, [], [], undefined, rollbackMetadata);
        }
        return {
          ok: false,
          diagnostics: [createDocumentRepositoryDiagnostic(writeResult.status)],
        };
      }

      activeMetadata = writeResult.metadata;
      const persistedValidatedState = authoredDocumentsEqual(activeDocument, writeResult.document);
      activeDocument = writeResult.document;
      markRepositorySnapshotFresh(writeResult.metadata,
        options.validateBeforePersist && persistedValidatedState ? activeDocument : undefined,
        activeRuntimeRevisionId);
      if (options.validateBeforePersist && persistedValidatedState && activeRuntimeRevisionId) restoredMutationPredecessor = {
        document: structuredClone(activeDocument), runtimeRevisionId: activeRuntimeRevisionId,
      };
      restoreDiagnostics = writeResult.diagnostics ?? [];
    }

    if (!options.validateBeforePersist) {
      await restoreActiveDocument();
    }
    operationHistoryStore?.clear();
    resetOperationHistoryPayloadForCurrentRepository();
    canPersistOperationHistory = true;
    canPersistAuthoredDocument = true;
    initialRepositoryLoadFailure = null;
    // The in-memory document was replaced; nothing unsaved remains.
    unsavedLocalChange = null;
    historyRestoreState = {
      kind: "restored",
      entriesReplayed: 0,
      diagnostics: [],
    };

    if (options.fetchSnapshot === false) {
      return {
        ok: true,
        revisionId: activeDocument.revisionId,
        diagnostics: restoreDiagnostics,
      };
    }

    const snapshot = validateSnapshotResponse(
      await adapter.getDocumentSnapshot(
        buildDocumentRequest(currentDocumentId),
      ),
      currentDocumentId,
    );

    return {
      ok: true,
      revisionId: snapshot.document.revisionId,
      diagnostics: snapshot.document.diagnostics,
    };
  }

  async function createRepositoryHeadConflictResult<
    T extends {
      revisionId: RevisionId;
      revisionState: MutationRevisionState;
      rebuildResult: RebuildResult;
      changedTargets: PrimitiveRef[];
      diagnostics: ModelingDiagnostic[];
    },
  >(result: T, input: { baseRepositoryHeads?: readonly string[] }): Promise<T> {
    // Runs inside a local mutation, after the repository changes received
    // before it (`runLocalMutation`); later ones wait for the mutation.
    const snapshot = validateSnapshotResponse(
      await adapter.getDocumentSnapshot(
        buildDocumentRequest(currentDocumentId),
      ),
      currentDocumentId,
    );
    const diagnostics = result.diagnostics.some(
      (diagnostic) => diagnostic.code === "repository-head-conflict",
    )
      ? result.diagnostics
      : addRepositoryFreshnessDiagnostic(result, input).diagnostics;
    const expectedRevisionId =
      result.revisionState.kind === "accepted"
        ? result.revisionState.baseRevisionId
        : result.revisionId;

    return {
      ...result,
      revisionId: snapshot.document.revisionId,
      revisionState: {
        kind: "conflict",
        expectedRevisionId,
        actualRevisionId: snapshot.document.revisionId,
      },
      rebuildResult: {
        kind: "skipped",
        reasonCode: "revisionConflict",
        invalidatedTargets: [],
        diagnostics,
      },
      changedTargets: [],
      diagnostics,
    };
  }

  function publicationDocument(
    base: AuthoredModelDocument,
    sketchId: AuthoredModelDocument["sketches"][number]["sketchId"],
    sketch: AuthoredModelDocument["sketches"][number] | null,
  ) {
    const document = structuredClone(base);
    const index = document.sketches.findIndex(
      (entry) => entry.sketchId === sketchId,
    );
    if (sketch === null) {
      if (index >= 0) document.sketches.splice(index, 1);
    } else if (index >= 0) {
      document.sketches[index] = structuredClone(sketch);
    } else {
      document.sketches.push(structuredClone(sketch));
    }
    return document;
  }

  async function publishCommittedSketch<
    T extends {
      revisionId: RevisionId;
      revisionState: MutationRevisionState;
      rebuildResult: RebuildResult;
      changedTargets: PrimitiveRef[];
      diagnostics: ModelingDiagnostic[];
      sketchId: AuthoredModelDocument["sketches"][number]["sketchId"];
    },
  >(input: {
    latestShared: AuthoredModelDocument;
    normalizedCandidate: AuthoredModelDocument;
    expectedSketch: AuthoredModelDocument["sketches"][number] | null;
    observe?: import("./types").ModelingCommitSketchInput["observePublication"];
    result: T;
  }): Promise<T & { durabilityPending?: boolean }> {
    if (!documentRepository || input.result.revisionState.kind !== "accepted") {
      return input.result;
    }
    const normalizedSketch = input.normalizedCandidate.sketches.find(
      (sketch) => sketch.sketchId === input.result.sketchId,
    );
    if (!normalizedSketch)
      throw new Error(
        `Published sketch ${input.result.sketchId} is missing from the normalized kernel candidate.`,
      );
    const expectedSketch = input.expectedSketch
      ? structuredClone(input.expectedSketch)
      : null;
    const expected = publicationDocument(
      input.latestShared,
      input.result.sketchId,
      expectedSketch,
    );
    const candidate = publicationDocument(
      expected,
      input.result.sketchId,
      normalizedSketch,
    );
    if (
      input.expectedSketch === null &&
      !candidate.historyOrder.some(
        (entry) =>
          entry.kind === "sketch" && entry.sketchId === input.result.sketchId,
      )
    ) {
      candidate.historyOrder.push({
        kind: "sketch",
        sketchId: input.result.sketchId,
      });
      candidate.cursor = {
        kind: "sketch",
        sketchId: input.result.sketchId,
      };
    }
    candidate.revisionId = input.normalizedCandidate.revisionId;
    const write = await documentRepository.mutate({
      documentId: currentDocumentId,
      expected,
      document: candidate,
      label: "Publish Sketch",
    });
    input.observe?.(write);
    // T17k3 (R-1): the write is a three-way commit onto the current shared
    // state; when that state held a peer change, the merged document is not
    // the published candidate and gets a new revision.
    const restorePublished = async (
      document: AuthoredModelDocument,
      diagnostics: ModelingDiagnostic[] = [],
      metadata?: DocumentRepositoryMetadata,
    ) => {
      await (authoredDocumentsEqual(document, candidate)
        ? restoreAuthoredRepositoryDocument(document, diagnostics, [], undefined, metadata)
        : restoreRepositoryState(document, diagnostics, metadata));
      // A peer change queued during the write needs no second restore when
      // this is already the newest repository state.
      if (
        latestRepositoryEvent &&
        authoredDocumentsEqual(latestRepositoryEvent.document, document)
      )
        restoredRepositoryEvent = latestRepositoryEvent;
    };
    if (write.ok || write.appliedLive) {
      const committed = write.ok ? write : write.appliedLive!;
      const publicationEvent = latestRepositoryEvent;
      const diagnostics = [
        ...input.result.diagnostics,
        ...(committed.diagnostics ?? []),
        ...(!write.ok ? [createDocumentRepositoryDiagnostic(write.status)] : []),
      ];
      if (!write.ok) canPersistAuthoredDocument = false;
      markRepositorySnapshotFresh(committed.metadata);
      let revisionId = committed.document.revisionId;
      try {
        // T17k3: keep awaiting the merged restore so a successful handoff names
        // the actual runtime revision, not the candidate's pre-merge revision.
        await restorePublished(committed.document, committed.diagnostics, committed.metadata);
        revisionId = await currentRevisionId();
      } catch (error) {
        // The authored write is already committed. Reporting an unapplied edit
        // retains the editor's old private baseline and poisons every Finish.
        // Return its receipt, and retry runtime recovery (never publication)
        // before a snapshot or the next mutation can use the incomplete runtime.
        const diagnostic: ModelingDiagnostic = {
          code: "sketch-publication-restore-failed",
          severity: "warning",
          message: `Sketch published, but the document refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          target: { kind: "sketch", sketchId: input.result.sketchId },
          detail: null,
        };
        diagnostics.push(diagnostic);
        pendingPublicationRestore = async () => {
          // A peer may have arrived after the write; recovery must not restore
          // the older publication over the newer authoritative repository state.
          const latest = latestRepositoryEvent !== publicationEvent
            ? latestRepositoryEvent ?? committed
            : committed;
          await restorePublished(latest.document, [...(latest.diagnostics ?? []), ...diagnostics], latest.metadata);
        };
      }
      return {
        ...input.result,
        revisionId,
        ...(!write.ok ? { durabilityPending: true } : {}),
        diagnostics,
      };
    }
    const restored = await documentRepository.load({
      documentId: currentDocumentId,
      seedDocument: input.latestShared,
    });
    if (restored.ok) {
      markRepositorySnapshotFresh(restored.metadata);
      await restoreRepositoryState(restored.document, restored.diagnostics, restored.metadata);
    } else {
      await restoreRepositoryState(input.latestShared, [
        createDocumentRepositoryDiagnostic(restored.status),
      ]);
    }
    const actualRevisionId = await currentRevisionId();
    return {
      ...input.result,
      revisionId: actualRevisionId,
      revisionState: {
        kind: "conflict",
        expectedRevisionId: input.latestShared.revisionId,
        actualRevisionId,
      },
      rebuildResult: {
        kind: "skipped",
        reasonCode: "revisionConflict",
        invalidatedTargets: [],
        diagnostics: [createDocumentRepositoryDiagnostic(write.status)],
      },
      changedTargets: [],
      diagnostics: [
        createDocumentRepositoryDiagnostic(write.status),
        ...(restored.ok
          ? []
          : [createDocumentRepositoryDiagnostic(restored.status)]),
      ],
    };
  }

  async function finalizeMutationResult<
    T extends {
      revisionId: RevisionId;
      revisionState: MutationRevisionState;
      rebuildResult: RebuildResult;
      changedTargets: PrimitiveRef[];
      diagnostics: ModelingDiagnostic[];
    },
  >(
    expected: AuthoredModelDocument,
    response: ModelingOperationResult,
    result: T,
    input: { baseRepositoryHeads?: readonly string[]; observePersistence?: (transaction: DocumentRepositoryMutationResult) => void },
    createHistoryEntry: (() => ModelingOperationHistoryEntry) | null,
    /** The document history entry's label (the repository default otherwise). */
    label?: string,
  ): Promise<T> {
    const repositoryConflict = repositoryHeadsChangedSinceBasis(input);
    const freshResult = repositoryConflict
      ? addRepositoryFreshnessDiagnostic(result, input)
      : result;

    if (!isAcceptedMutation(response)) {
      return freshResult;
    }

    if (repositoryConflict) {
      return createRepositoryHeadConflictResult(freshResult, input);
    }

    if (createHistoryEntry) {
      appendOperationHistoryEntry(createHistoryEntry());
      if (documentRepositoryPersistence === "background") {
        await enqueueAcceptedAuthoredDocumentPersistence(expected, label, input.observePersistence);
        return freshResult;
      }
    } else if (documentRepositoryPersistence === "background") {
      await enqueueAcceptedAuthoredDocumentPersistence(expected, label, input.observePersistence);
      return freshResult;
    }

    return persistAcceptedAuthoredDocument(freshResult, expected, label, input.observePersistence);
  }

  function notifyModelingDocumentChange(event: DocumentRepositoryChangeEvent) {
    const serviceEvent: ModelingServiceDocumentChangeEvent = {
      documentId: currentDocumentId,
      metadata: event.metadata,
    };
    latestDocumentChangeEvent = {
      documentId: serviceEvent.documentId,
      metadata: {
        ...serviceEvent.metadata,
        heads: [...serviceEvent.metadata.heads],
      },
    };
    for (const listener of documentChangeListeners) {
      listener(latestDocumentChangeEvent);
    }
  }

  function isCurrentRestoredRepositoryEvent(event: DocumentRepositoryChangeEvent) {
    const metadata = documentRepository!.getMetadata(currentDocumentId);
    return event.status.kind === "restored" &&
      documentRepository!.getRestoreStatus(currentDocumentId).kind === "restored" &&
      event.document.documentId === currentDocumentId &&
      event.metadata.documentId === currentDocumentId &&
      event.metadata.storageKey === metadata.storageKey &&
      sameStringSet(event.metadata.heads, metadata.heads);
  }

  function subscribeToDocumentRepository() {
    if (disposed || unsubscribeDocumentRepository || !documentRepository) {
      return;
    }

    const unsubscribe = documentRepository.subscribe(
      currentDocumentId,
      (event) => {
        if (disposed) return;
        rememberRepositoryMetadata(event.metadata);
        latestRepositoryEvent = event;
        if (
          event.metadata.source !== "peer" &&
          event.metadata.source !== "undo" &&
          event.metadata.source !== "redo"
        ) {
          if (isRestoringRepositoryDocument) {
            return;
          }

          notifyModelingDocumentChange(event);
          return;
        }

        // T17k3 (A-1): a change that arrives while local mutations are in
        // flight is restored after them and their repository writes, from the
        // newest repository state (which holds both); restoring the event's
        // own, older state would drop this session's accepted edit.
        const mutationsBefore = localMutations;
        repositoryChangePromise = repositoryChangePromise.then(async () => {
          await ensureInitialized();
          await mutationsBefore;
          await repositoryPersistencePromise;
          if (disposed) return;
          const latest = latestRepositoryEvent ?? event;
          // An explicit recovery that could not save the displayed state must
          // not lose it to automatic bootstrap recovery. Editor-private drafts
          // remain owned by the existing editor peer-reconciliation path.
          if (initialRepositoryLoadFailure && (
            unsavedLocalChange || pendingPublicationRestore || !isCurrentRestoredRepositoryEvent(latest)
          )) return;
          if (latest !== restoredRepositoryEvent) {
            const rollbackDocument = await exportAuthoredDocumentForRepository();
            const rollbackBasis = repositorySnapshotBasis;
            // Export may yield to an explicit lifecycle recovery. Recheck its
            // owned state before changing the kernel, not only after adoption.
            if (initialRepositoryLoadFailure && (
              unsavedLocalChange || pendingPublicationRestore || !isCurrentRestoredRepositoryEvent(latest)
            )) return;
            try {
              await adoptRepositoryState(rollbackDocument, latest);
            } catch (error) {
              try {
                await restoreAuthoredRepositoryDocument(rollbackDocument);
                if (rollbackBasis) repositorySnapshotBasis = {
                  ...rollbackBasis, runtimeRevisionId: await currentRevisionId(),
                };
              } catch (rollbackError) {
                throw new AggregateError([error, rollbackError], "Repository refresh and runtime rollback failed.");
              }
              throw error;
            }
            restoredRepositoryEvent = latest;
          }
          if (repositoryRestoreFailure) {
            historyRestoreState = repositoryRestoreFailure.previousHistoryState;
            repositoryRestoreFailure = null;
          }
          if (
            initialRepositoryLoadFailure &&
            latest === latestRepositoryEvent &&
            !unsavedLocalChange &&
            !pendingPublicationRestore &&
            isCurrentRestoredRepositoryEvent(latest)
          ) {
            // Only a successfully adopted canonical peer copy reopens writes;
            // do not replay or publish the provisional bootstrap document.
            initialRepositoryLoadFailure = null;
            canPersistOperationHistory = true;
            canPersistAuthoredDocument = true;
            resetOperationHistoryPayloadForCurrentRepository();
            historyRestoreState = { kind: "restored", entriesReplayed: 0, diagnostics: [] };
            initialLoadingStatus.setProgress(null);
            initialLoadingStatus.set("preparing-geometry");
          }
          if (!disposed) notifyModelingDocumentChange(event);
        }).catch((error: unknown) => {
          // Report each failed attempt through the existing restore diagnostic
          // channel, while keeping the subscription tail usable for later events.
          repositoryRestoreFailure = {
            error,
            previousHistoryState: repositoryRestoreFailure?.previousHistoryState ?? historyRestoreState,
          };
          historyRestoreState = createRestoreFailure(
            "repository-restore-exception",
            error instanceof Error ? error.message : "Repository refresh failed unexpectedly.",
            null,
            historyRestoreState.entriesReplayed,
          );
          initialLoadingStatus.set("failed");
        });
      },
    );
    if (disposed) {
      unsubscribe();
      return;
    }
    unsubscribeDocumentRepository = unsubscribe;
  }

  async function replayOperationHistoryPayload(
    loadResultPayload: ModelingOperationHistoryPayload,
  ) {
    beginRuntimeChange();
    operationHistoryPayload = structuredClone(loadResultPayload);
    let replayCursor = await getAdapterReplayCursor(adapter, currentDocumentId);

    for (const [entryIndex, entry] of loadResultPayload.entries.entries()) {
      const { response, cursor } = await replayHistoryEntry({
        adapter,
        documentId: currentDocumentId,
        entry,
        entryIndex,
        cursor: replayCursor,
      });
      replayCursor = cursor;

      if (!isAcceptedMutation(response)) {
        canPersistOperationHistory = false;
        historyRestoreState = createRestoreFailure(
          response.revisionState.kind === "rejected"
            ? response.revisionState.reasonCode
            : "revision-conflict",
          `Operation history replay failed at entry ${entryIndex}.`,
          entryIndex,
          entryIndex,
        );
        return;
      }

      historyRestoreState = {
        kind: "restored",
        entriesReplayed: entryIndex + 1,
        diagnostics: [],
      };
    }

    historyRestoreState =
      loadResultPayload.entries.length === 0
        ? { kind: "empty", entriesReplayed: 0, diagnostics: [] }
        : {
            kind: "restored",
            entriesReplayed: loadResultPayload.entries.length,
            diagnostics: [],
          };
  }

  async function restoreOperationHistoryCompatibility() {
    await getSeedAuthoredDocument();
    const loadResult = loadOrCreateOperationHistory(
      operationHistoryStore,
      currentDocumentId,
    );

    if (!loadResult.ok) {
      canPersistOperationHistory = false;
      historyRestoreState = createRestoreFailure(
        loadResult.reasonCode,
        loadResult.message,
        null,
        0,
      );
      return;
    }

    if (loadResult.payload.documentId !== currentDocumentId) {
      canPersistOperationHistory = false;
      historyRestoreState = createRestoreFailure(
        "document-id-mismatch",
        "Operation history document identity does not match the active document.",
        null,
        0,
      );
      return;
    }

    if (loadResult.payload.baseRepositoryHeads !== undefined) {
      canPersistOperationHistory = false;
      historyRestoreState = {
        kind: "empty",
        entriesReplayed: 0,
        diagnostics: [],
      };
      return;
    }

    await replayOperationHistoryPayload(loadResult.payload);
  }

  /**
   * cadara-dx2k.17: the first snapshot of the open is answered, so the
   * repository may finish reading the stored copy now (a reload answered
   * from its materialized-document cache defers that ~1 s Automerge load,
   * which would otherwise delay the open's own repository requests). An
   * edit made before the read finished waits for it.
   */
  function settleRepositoryLoadOnce() {
    if (repositoryLoadSettled || !documentRepository) return;
    repositoryLoadSettled = true;
    documentRepository.settleLoad?.(currentDocumentId);
  }

  async function restoreRepositoryBackedDocument() {
    // The seed comes from the kernel, whose first answer waits for its runtime
    // to boot; a stored document is read meanwhile (only a missing one needs
    // the seed).
    const [seedDocument] = await Promise.all([
      getSeedAuthoredDocument(),
      documentRepository!.preload?.(currentDocumentId),
    ]);
    const loadResult = await documentRepository!.load({
      documentId: currentDocumentId,
      seedDocument,
    });

    if (!loadResult.ok) {
      initialRepositoryLoadFailure = loadResult.status;
      canPersistOperationHistory = false;
      canPersistAuthoredDocument = false;
      historyRestoreState = createRepositoryRestoreFailure(loadResult.status);
      return;
    }

    rememberRepositoryMetadata(loadResult.metadata);
    if (loadResult.status.kind === "seeded" && authoredDocumentsEqual(loadResult.document, seedDocument)) {
      markRepositorySnapshotFresh(loadResult.metadata, loadResult.document, seedDocument.revisionId);
    }

    const historyLoadResult = operationHistoryStore?.load();

    if (loadResult.status.kind === "restored") {
      // The document is open; rebuilding its features is geometry work, and
      // the kernel reports it per feature (cadara-ku5k).
      initialLoadingStatus.set("preparing-geometry");
      await restoreAuthoredRepositoryDocument(
        loadResult.document,
        loadResult.diagnostics,
        [],
        { onProgress: initialLoadingStatus.setProgress, openStoredDocument: true },
        loadResult.metadata,
      );
      // Snapshot and mesh preparation follow without a measured total.
      initialLoadingStatus.setProgress(null);
      if (
        historyLoadResult?.ok &&
        historyLoadResult.payload &&
        historyLoadResult.payload.entries.length > 0 &&
        historyLoadResult.payload.documentId === currentDocumentId &&
        canReplayOperationHistoryOverRestoredRepository(
          historyLoadResult.payload,
          loadResult.document,
          seedDocument,
          loadResult.metadata,
        )
      ) {
        await replayOperationHistoryPayload(historyLoadResult.payload);
        if (historyRestoreState.kind === "failed") {
          canPersistAuthoredDocument = false;
          return;
        }

        const writeResult = await documentRepository!.mutate({
          documentId: currentDocumentId,
          expected: loadResult.document,
          document: await exportAuthoredDocumentForRepository(),
        });
        if (!writeResult.ok) {
          canPersistOperationHistory = false;
          canPersistAuthoredDocument = false;
          historyRestoreState = createRepositoryRestoreFailure(
            writeResult.status,
            historyRestoreState.entriesReplayed,
          );
          return;
        }

        markRepositorySnapshotFresh(writeResult.metadata, writeResult.document);
        operationHistoryStore?.clear();
        resetOperationHistoryPayloadForCurrentRepository();
        return;
      }

      resetOperationHistoryPayloadForCurrentRepository();
      historyRestoreState = {
        kind: "restored",
        entriesReplayed: 0,
        diagnostics: [],
      };
      return;
    }

    if (historyLoadResult && !historyLoadResult.ok) {
      operationHistoryStore?.clear();
      resetOperationHistoryPayloadForCurrentRepository();
      historyRestoreState = {
        kind: "empty",
        entriesReplayed: 0,
        diagnostics: [],
      };
      return;
    }

    if (
      historyLoadResult?.payload &&
      historyLoadResult.payload.entries.length > 0
    ) {
      if (historyLoadResult.payload.documentId !== currentDocumentId) {
        await documentRepository!.reset(currentDocumentId);
        canPersistOperationHistory = false;
        canPersistAuthoredDocument = false;
        historyRestoreState = createRestoreFailure(
          "document-id-mismatch",
          "Operation history document identity does not match the active document.",
          null,
          0,
        );
        return;
      }

      await replayOperationHistoryPayload(historyLoadResult.payload);
      if (historyRestoreState.kind === "failed") {
        await documentRepository!.reset(currentDocumentId);
        canPersistAuthoredDocument = false;
        return;
      }

      const writeResult = await documentRepository!.mutate({
        documentId: currentDocumentId,
        expected: loadResult.document,
        document: await exportAuthoredDocumentForRepository(),
      });
      if (!writeResult.ok) {
        await documentRepository!.reset(currentDocumentId);
        canPersistOperationHistory = false;
        canPersistAuthoredDocument = false;
        historyRestoreState = createRepositoryRestoreFailure(
          writeResult.status,
          historyRestoreState.entriesReplayed,
        );
      }
      if (writeResult.ok) {
        markRepositorySnapshotFresh(writeResult.metadata, writeResult.document);
        operationHistoryStore?.clear();
        resetOperationHistoryPayloadForCurrentRepository();
      }
      return;
    }

    resetOperationHistoryPayloadForCurrentRepository();
    historyRestoreState = {
      kind: "empty",
      entriesReplayed: 0,
      diagnostics: [],
    };
  }

  function ensureInitialized(): Promise<void> {
    if (disposed) {
      return Promise.reject(new Error("Modeling service has been disposed."));
    }
    if (initializationPromise) return initializationPromise;

    const initialize = Promise.resolve().then(async () => {
      if (documentRepository) {
        await restoreRepositoryBackedDocument();
        return;
      }

      await restoreOperationHistoryCompatibility();
    });
    initializationPromise = initialize
      .catch((error: unknown) => {
        canPersistOperationHistory = false;
        canPersistAuthoredDocument = false;
        historyRestoreState = createRestoreFailure(
          "initialization-exception",
          error instanceof Error
            ? error.message
            : "Modeling service initialization failed unexpectedly.",
          null,
          historyRestoreState.entriesReplayed,
        );
        // Recoverable history failures return diagnostics; thrown failures may
        // be kernel/cleanup errors whose identity and retry ownership matter.
        throw error;
      })
      .finally(() => {
        isRestoringRepositoryDocument = false;
        initializationSettled = true;
        initialLoadingStatus.set(
          historyRestoreState.kind === "failed" ? "failed" : "preparing-geometry",
        );
        if (disposed) disposeAdapter();
      });
    subscribeToDocumentRepository();
    return initializationPromise;
  }

  function disposeAdapter() {
    if (adapterDisposed) return;
    adapterDisposed = true;
    adapter.dispose?.();
  }

  function resetOperationHistory() {
    const resetLocalHistory = () => {
      operationHistoryStore?.clear();
      operationHistoryPayload = createEmptyOperationHistory(currentDocumentId);
      canPersistOperationHistory = true;
      // Reset deliberately resolves the displayed state, not an older failure.
      unsavedLocalChange = null;
      publishLocalSaveStatus();
      historyRestoreState = {
        kind: "empty",
        entriesReplayed: 0,
        diagnostics: [],
      };
    };
    if (!documentRepository) {
      resetLocalHistory();
      canPersistAuthoredDocument = true;
      return;
    }
    // cadara-rnsb: the reset deletes the stored document, so store the one on
    // screen as its replacement; until then (and if that fails) edits are not
    // persisted. Later edits and writes queue behind this recovery.
    const repository = documentRepository;
    const changesBefore = repositoryChangePromise;
    const mutationsBefore = localMutations;
    const writesBefore = repositoryPersistencePromise;
    const recovery = (async () => {
      await changesBefore;
      await mutationsBefore;
      await writesBefore;
      if (disposed) return null;
      resetLocalHistory();
      canPersistAuthoredDocument = false;
      // Export first: a failed export must not leave storage deleted.
      const document = await exportAuthoredDocumentForRepository();
      if (disposed) return null;
      const reset = await repository.reset(currentDocumentId);
      if (reset.kind === "failed") return reset.diagnostic;
      const initialized = await repository.initialize({
        documentId: currentDocumentId,
        document,
      });
      if (!initialized.ok) return initialized.status.diagnostic;
      markRepositorySnapshotFresh(initialized.metadata,
        authoredDocumentsEqual(document, initialized.document) ? initialized.document : undefined,
        document.revisionId);
      operationHistoryPayload = createEmptyOperationHistoryForCurrentRepository();
      canPersistAuthoredDocument = true;
      initialRepositoryLoadFailure = null;
      // Edits refused while storage was unavailable are stored now.
      unsavedLocalChange = null;
      // An earlier overlapping reset may have recorded a failure.
      historyRestoreState = {
        kind: "empty",
        entriesReplayed: 0,
        diagnostics: [],
      };
      return null;
    })()
      .catch((error: unknown) => ({
        reasonCode: "repository-reset-exception",
        message:
          error instanceof Error
            ? error.message
            : "Stored history could not be reset.",
      }))
      .then((failure) => {
        if (!failure) return;
        // Reported like a failed background write (cadara-8p7o).
        unsavedLocalChange = failure;
        historyRestoreState = createRestoreFailure(
          failure.reasonCode,
          failure.message,
          null,
          0,
        );
      });
    // Own reset through the lifecycle tail, like New/Import. An earlier peer
    // must not await this recovery as persistence while recovery awaits it.
    localMutations = recovery;
    trackLocalSave(recovery);
  }

  function appendOperationHistoryEntry(
    entry: ModelingOperationHistoryEntry,
  ): void {
    if (!operationHistoryStore || !canPersistOperationHistory) {
      return;
    }

    operationHistoryPayload = {
      ...operationHistoryPayload,
      entries: [...operationHistoryPayload.entries, structuredClone(entry)],
    };

    try {
      operationHistoryStore.save(operationHistoryPayload);
      return;
    } catch (error: unknown) {
      canPersistOperationHistory = false;
      historyRestoreState = createRestoreFailure(
        "history-write-failed",
        error instanceof Error
          ? error.message
          : "Operation history could not be written.",
        null,
        operationHistoryPayload.entries.length,
      );
    }
  }

  async function persistAcceptedAuthoredDocument<
    T extends { diagnostics: ModelingDiagnostic[] },
  >(result: T, expected: AuthoredModelDocument, label?: string, observe?: (transaction: DocumentRepositoryMutationResult) => void): Promise<T> {
    if (!documentRepository) {
      return result;
    }

    if (!canPersistAuthoredDocument) {
      const status = documentRepository.getRestoreStatus(currentDocumentId);
      unsavedLocalChange =
        status.kind === "failed" ? status.diagnostic : STORAGE_UNAVAILABLE;
      return status.kind === "failed"
        ? {
            ...result,
            diagnostics: [
              ...result.diagnostics,
              createDocumentRepositoryDiagnostic(status),
            ],
          }
        : result;
    }

    const document = await exportAcceptedAuthoredDocument();
    const writeResult = await documentRepository.mutate({
      documentId: currentDocumentId,
      expected,
      document,
      ...(label === undefined ? {} : { label }),
    });
    observe?.(writeResult);

    if (writeResult.ok) {
      markRepositorySnapshotFresh(writeResult.metadata,
        authoredDocumentsEqual(document, writeResult.document) ? writeResult.document : undefined,
        document.revisionId);
      return result;
    }

    if (writeResult.appliedLive) {
      markRepositorySnapshotFresh(writeResult.appliedLive.metadata,
        authoredDocumentsEqual(document, writeResult.appliedLive.document) ? writeResult.appliedLive.document : undefined,
        document.revisionId);
    }
    canPersistAuthoredDocument = false;
    unsavedLocalChange = writeResult.status.diagnostic;
    return {
      ...result,
      diagnostics: [
        ...result.diagnostics,
        createDocumentRepositoryDiagnostic(writeResult.status),
      ],
    };
  }

  function reconcileOperationHistoryAfterRepositoryWrite(
    persistedEntries: readonly ModelingOperationHistoryEntry[] | null,
  ) {
    if (!operationHistoryStore || !persistedEntries?.length) {
      return;
    }

    const remaining = operationHistoryPayload.entries.filter(
      (entry) => !persistedEntries.includes(entry),
    );
    if (remaining.length === 0) {
      operationHistoryStore.clear();
      resetOperationHistoryPayloadForCurrentRepository();
      canPersistOperationHistory = true;
      return;
    }

    operationHistoryPayload = {
      ...createEmptyOperationHistoryForCurrentRepository(),
      entries: remaining,
    };

    try {
      operationHistoryStore.save(operationHistoryPayload);
      canPersistOperationHistory = true;
    } catch (error: unknown) {
      canPersistOperationHistory = false;
      historyRestoreState = createRestoreFailure(
        "history-write-failed",
        error instanceof Error
          ? error.message
          : "Operation history could not be written.",
        null,
        operationHistoryPayload.entries.length,
      );
    }
  }

  async function enqueueAcceptedAuthoredDocumentPersistence(
    expected: AuthoredModelDocument,
    label?: string,
    observe?: (transaction: DocumentRepositoryMutationResult) => void,
  ) {
    if (!documentRepository) {
      return;
    }
    if (!canPersistAuthoredDocument) {
      unsavedLocalChange ??= STORAGE_UNAVAILABLE;
      return;
    }

    const document = await exportAcceptedAuthoredDocument();
    // Capture the existing replay tail associated with this exact candidate, not later queued work.
    const persistedHistory = operationHistoryStore
      ? [...operationHistoryPayload.entries]
      : null;
    repositoryPersistencePromise = repositoryPersistencePromise
      .then(async () => {
        if (!canPersistAuthoredDocument || !documentRepository) {
          unsavedLocalChange ??= STORAGE_UNAVAILABLE;
          return;
        }
        const writeResult = await documentRepository.mutate({
          documentId: currentDocumentId,
          expected,
          document,
          ...(label === undefined ? {} : { label }),
        });
        observe?.(writeResult);

        if (writeResult.ok) {
          markRepositorySnapshotFresh(writeResult.metadata,
            authoredDocumentsEqual(document, writeResult.document) ? writeResult.document : undefined,
            document.revisionId);
          reconcileOperationHistoryAfterRepositoryWrite(persistedHistory);
          return;
        }

        if (writeResult.appliedLive) {
          markRepositorySnapshotFresh(writeResult.appliedLive.metadata,
            authoredDocumentsEqual(document, writeResult.appliedLive.document) ? writeResult.appliedLive.document : undefined,
            document.revisionId);
        }
        canPersistAuthoredDocument = false;
        unsavedLocalChange = writeResult.status.diagnostic;
        historyRestoreState = createRestoreFailure(
          writeResult.status.diagnostic.reasonCode,
          writeResult.status.diagnostic.message,
          null,
          historyRestoreState.entriesReplayed,
        );
      })
      .catch((error: unknown) => {
        canPersistAuthoredDocument = false;
        unsavedLocalChange = {
          reasonCode: "repository-write-exception",
          message:
            error instanceof Error
              ? error.message
              : "Authored document could not be written.",
        };
        historyRestoreState = createRestoreFailure(
          unsavedLocalChange.reasonCode,
          unsavedLocalChange.message,
          null,
          historyRestoreState.entriesReplayed,
        );
      });
    trackLocalSave(repositoryPersistencePromise);
    // A semantic caller awaits this exact candidate's write, not a fulfilled global drain.
    if (observe) await repositoryPersistencePromise;
  }

  async function exportCurrentDocumentNow(
    input: Parameters<ModelingService["exportCurrentDocument"]>[0],
  ): ReturnType<ModelingService["exportCurrentDocument"]> {
    // Saving is not a new authored mutation. A rebuilt restore may carry
    // different native witnesses and a fresh live id; synchronize and export
    // the exact stored basis it still represents, not a phantom new action.
    const document = await getMutationPredecessor();
    if (input && documentRepository) {
      // Explicit native save observes its own synchronization transaction;
      // a fulfilled global persistence tail cannot certify durability.
      const receipt = await documentRepository.mutate({
        documentId: currentDocumentId,
        document,
        expected: document,
      });
      input.observe(receipt);
      if (!receipt.ok) throw new Error(receipt.status.diagnostic.message);
      const liveRevisionId = restoredMutationPredecessor && authoredDocumentsEqual(restoredMutationPredecessor.document, document)
        ? restoredMutationPredecessor.runtimeRevisionId : document.revisionId;
      markRepositorySnapshotFresh(receipt.metadata,
        authoredDocumentsEqual(document, receipt.document) ? receipt.document : undefined,
        liveRevisionId);
    }

    return {
      ok: true,
      format: "cadara",
      filename: "document.cadara",
      extension: "cadara",
      mimeType: "application/vnd.cadara+json",
      payload: createLocalAuthoredDocumentPayload(document),
      diagnostics: [],
    };
  }

  return {
    initialLoadingStatus,
    currentDocumentId,
    sketchSolver,
    neutralCurveQueries: adapter,
    dispose() {
      if (disposed) return;
      disposed = true;
      initialLoadingStatus.dispose();
      unsubscribeLocalFileWrites?.();
      localSaveStatusListeners.clear();
      unsubscribeDocumentRepository?.();
      unsubscribeDocumentRepository = undefined;
      documentChangeListeners.clear();
      if (!initializationPromise || initializationSettled) {
        disposeAdapter();
      }
    },
    subscribeToDocumentChanges(listener) {
      if (disposed) return () => undefined;
      documentChangeListeners.add(listener);
      void ensureInitialized();
      if (latestDocumentChangeEvent) {
        queueMicrotask(() => {
          if (
            !documentChangeListeners.has(listener) ||
            !latestDocumentChangeEvent
          ) {
            return;
          }

          listener({
            documentId: latestDocumentChangeEvent.documentId,
            metadata: {
              ...latestDocumentChangeEvent.metadata,
              heads: [...latestDocumentChangeEvent.metadata.heads],
            },
          });
        });
      }
      return () => {
        documentChangeListeners.delete(listener);
      };
    },
    async waitForPersistence() {
      await ensureInitialized();
      await waitForLocalMutations();
      await waitForRepositoryChanges();
      await repositoryPersistencePromise;
    },
    waitForLocalMutations,
    async waitForLocalChanges() {
      // A mutation queues its repository write only once it has run.
      await waitForLocalMutations();
      try {
        await ensureInitialized();
        await waitForRepositoryChanges();
      } catch (error) {
        // A document that failed to open, or to take a repository change,
        // refuses local mutations and already shows that failure: nothing
        // here is left to save, so it must not block (cadara-vk96).
        if (historyRestoreState.kind !== "failed" && !repositoryRestoreFailure) {
          throw error;
        }
      }
      await repositoryPersistencePromise;
      if (unsavedLocalChange !== null) {
        throw new Error(
          `Local changes could not be saved, so reloading would lose them: ${unsavedLocalChange.message}`,
        );
      }
    },
    getLocalSaveStatus() {
      return localSaveStatus;
    },
    trackLocalSave(work) {
      trackLocalSave(work.then(
        () => undefined,
        () => undefined,
      ));
    },
    subscribeToLocalSaveStatus(listener) {
      if (disposed) return () => undefined;
      localSaveStatusListeners.add(listener);
      return () => {
        localSaveStatusListeners.delete(listener);
      };
    },
    async getHistoryRestoreState() {
      await ensureInitialized();
      await repositoryChangePromise;
      return historyRestoreState;
    },
    resetOperationHistory,
    setViewportLodTier(tierId) {
      if (!adapter.refineSnapshotLod || requestedViewportLodTierId === tierId) {
        return false;
      }
      requestedViewportLodTierId = tierId;
      return true;
    },
    async refineViewportLod() {
      if (!adapter.refineSnapshotLod) return false;
      const tierId = requestedViewportLodTierId;
      let refined = false;
      try {
        await ensureInitialized();
        refined = await adapter.refineSnapshotLod(
          buildDocumentRequest(currentDocumentId),
          tierId,
        );
        if (refined) displayedViewportLodTierId = tierId;
        return refined;
      } finally {
        // A failed or dropped refinement keeps the displayed tier; forget the
        // request so the next lodTierChanged for this tier retries it.
        if (!refined && requestedViewportLodTierId === tierId) {
          requestedViewportLodTierId = displayedViewportLodTierId;
        }
      }
    },
    async getCurrentDocumentSnapshot() {
      try {
        await ensureInitialized();
        let read: { runtime: number; response: GetDocumentSnapshotResponse } | null = null;
        for (;;) {
          const changes = repositoryChangePromise;
          await waitForRepositoryChanges(changes);
          await recoverPublishedDocument();
          const generation = stateGeneration;
          // A retry caused only by repository metadata (e.g. this session's own
          // write being acknowledged) keeps the unchanged runtime's snapshot.
          if (read?.runtime !== runtimeGeneration) {
            const runtime: number = runtimeGeneration;
            read = { runtime, response: await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)) };
          }
          const { response } = read;
          // Retry reads that raced a repository restore before publishing readiness.
          if (generation !== stateGeneration || changes !== repositoryChangePromise) continue;
          const snapshot = attachRepositoryProvenance(validateSnapshotResponse(response, currentDocumentId));
          if (historyRestoreState.kind !== "failed") initialLoadingStatus.set("ready");
          settleRepositoryLoadOnce();
          return snapshot;
        }
      } catch (error) {
        initialLoadingStatus.set("failed");
        throw error;
      }
    },
    async buildNativeExactBrepPayload(input) {
      await ensureInitialized();
      await waitForRepositoryChanges();
      if (!adapter.buildNativeExactBrepPayload) {
        return {
          kind: "nativeTopologyUnavailable",
          diagnostics: [],
          capability: {
            kind: "missing",
            requiredEntrypoints: ["CadaraBuildNativeExactBrepPayload"],
            missingEntrypoints: ["CadaraBuildNativeExactBrepPayload"],
            diagnostics: [],
          },
        };
      }

      const result = await adapter.buildNativeExactBrepPayload(
        currentDocumentId,
        input.baseRevisionId,
        input.target,
      );
      return result as OccNativeTopologyWorkerResult<OccNativeExactBrepPayload>;
    },
    async createNewDocument(input) {
      return runLocalDocumentChange(async () => {
        const current = validateSnapshotResponse(
          await adapter.getDocumentSnapshot(
            buildDocumentRequest(currentDocumentId),
          ),
          currentDocumentId,
        );
        const seed = await getSeedAuthoredDocument();
        // A reset is a new authoritative revision, not a replay of the cached seed.
        // Reuse the kernel's allocator so subsequent modeling revisions stay ordered.
        return replaceCurrentAuthoredDocument(
          {
            ...seed,
            name: input?.name ?? seed.name,
            revisionId: createRevisionId(
              parseRevisionSequence(current.document.revisionId) + 1,
            ),
          },
          [],
          { observeTransaction: input?.observe },
        );
      }, true);
    },
    async importDocument(input) {
      return runLocalDocumentChange(async () => {
        const normalized = normalizeImportedDocument(input.document);
        if (!normalized.ok) {
          return normalized;
        }

        const current = validateSnapshotResponse(
          await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
          currentDocumentId,
        );
        // Fresh editing contexts cannot reuse a saved basis from an earlier owner.
        return replaceCurrentAuthoredDocument(
          {
            ...normalized.document,
            revisionId: createRevisionId(
              Math.max(
                parseRevisionSequence(current.document.revisionId),
                parseRevisionSequence(normalized.document.revisionId),
              ) + 1,
            ),
          },
          input.assets ?? [],
          {
            validateEmbeddedAssetsBeforePersist: true,
            validateBeforePersist: true,
            observeTransaction: input.observe,
          },
        );
      }, true);
    },
    async renameDocument(input) {
      return runLocalDocumentChange(async () => {
        if (initialRepositoryLoadFailure) return {
          ok: false,
          diagnostics: [createDocumentRepositoryDiagnostic(initialRepositoryLoadFailure)],
        };
        const document = await exportRuntimeDocument();
        if (document.name === input.name) {
          const snapshot = validateSnapshotResponse(
            await adapter.getDocumentSnapshot(
              buildDocumentRequest(currentDocumentId),
            ),
            currentDocumentId,
          );
          return {
            ok: true,
            revisionId: snapshot.document.revisionId,
            diagnostics: snapshot.document.diagnostics,
          };
        }

        // The name feeds no evaluated state, so the kernel renames the
        // document in place instead of restoring it (cadara-kv69).
        const expected = await getMutationPredecessor(document);
        let receipt: DocumentRepositoryMutationResult | null = null;
        const result = await applyLocalMutation(async () => {
          const response = await adapter.renameDocument({
            ...buildDocumentRequest(currentDocumentId),
            baseRevisionId: document.revisionId,
            name: input.name,
          });
          return finalizeMutationResult(
            expected,
            response,
            response,
            {
              // An observer makes a background write awaited; a synchronous
              // write is awaited anyway.
              observePersistence:
                input.observe || documentRepositoryPersistence !== "background"
                  ? (transaction) => {
                      receipt = transaction;
                      input.observe?.(transaction);
                    }
                  : undefined,
            },
            null,
            "Rename document",
          );
        });
        const refused = receipt as DocumentRepositoryMutationResult | null;
        if (refused && !refused.ok && !refused.appliedLive) {
          // The repository refused the write before applying it, so the
          // document keeps its name, and so does the kernel.
          const rollback = await applyLocalMutation(() =>
            adapter.renameDocument({
              ...buildDocumentRequest(currentDocumentId),
              baseRevisionId: result.revisionId,
              name: document.name,
            }),
          );
          // A refused rollback leaves the kernel renamed: report why.
          return {
            ok: false,
            diagnostics: isAcceptedMutation(rollback)
              ? result.diagnostics
              : [...result.diagnostics, ...rollback.diagnostics],
          };
        }
        return result.revisionState.kind === "accepted"
          ? { ok: true, revisionId: result.revisionId, diagnostics: result.diagnostics }
          : { ok: false, diagnostics: result.diagnostics };
      });
    },
    async bindLocalFile(input) {
      await ensureInitialized();
      await waitForRepositoryChanges();
      if (!isLocalFileSyncDocumentRepository(documentRepository)) {
        return {
          ok: false,
          diagnostics: [
            createDocumentFileDiagnostic(
              "local-file-sync-unsupported-repository",
              "Local file sync is unavailable for the active document repository.",
            ),
          ],
        };
      }

      const result = await documentRepository.bindLocalFile({
        documentId: currentDocumentId,
        handle: input.handle,
        metadata: input.metadata,
      });
      if (!result.ok) {
        return {
          ok: false,
          diagnostics: [
            createDocumentFileDiagnostic(
              "local-file-sync-bind-failed",
              result.message,
            ),
          ],
        };
      }

      const snapshot = validateSnapshotResponse(
        await adapter.getDocumentSnapshot(
          buildDocumentRequest(currentDocumentId),
        ),
        currentDocumentId,
      );
      return {
        ok: true,
        revisionId: snapshot.document.revisionId,
        diagnostics: [],
      };
    },
    async restoreLocalFileBinding() {
      await ensureInitialized();
      await waitForRepositoryChanges();
      if (!isLocalFileSyncDocumentRepository(documentRepository)) {
        return null;
      }

      return documentRepository.restoreLocalFileBinding(currentDocumentId);
    },
    async getLocalFileSyncStatus() {
      if (!isLocalFileSyncDocumentRepository(documentRepository)) {
        return null;
      }

      return documentRepository.getLocalFileSyncStatus(currentDocumentId);
    },
    subscribeToLocalFileSyncStatus(listener) {
      if (!isLocalFileSyncDocumentRepository(documentRepository)) {
        return () => undefined;
      }

      return documentRepository.subscribeToLocalFileSyncStatus((status) => {
        if (status.documentId === currentDocumentId) {
          listener(status);
        }
      });
    },
    exportCurrentDocument(input) {
      // cadara-qj6: a save follows every local mutation requested before it,
      // and an explicit native save also follows their queued repository
      // writes, so its receipt cannot precede (and conflict with) them.
      // A copy (no input) writes nothing, so it is not a local save (cadara-8p7o).
      return runLocalDocumentChange(
        () => exportCurrentDocumentNow(input),
        input !== undefined,
        input !== undefined,
      );
    },
    commitSketch(input) {
      return runLocalMutation({
        operation: "Commit sketch",
        fallbackMessage: "Commit sketch failed.",
        requestId: input.solverCorrelation?.requestId,
        context: [{ key: "baseRevisionId", value: input.baseRevisionId }],
        action: async () => {
          const latestShared = await exportAuthoredDocumentForRepository();
          const request = normalizeCommitSketchInput(
            input.publicationBase
              ? {
                  ...input,
                  baseRevisionId: latestShared.revisionId,
                  baseRepositoryHeads: undefined,
                }
              : input,
            currentDocumentId,
          );
          const response = await adapter.commitSketch(request);
          const result = mapCommitSketchResponse(response, currentDocumentId);
          if (input.publicationBase && isAcceptedMutation(response)) {
            const normalizedCandidate =
              await exportAuthoredDocumentForRepository();
            const published = await publishCommittedSketch({
              latestShared,
              normalizedCandidate,
              expectedSketch: input.publicationBase.expectedSketch,
              observe: input.observePublication,
              result,
            });
            if (published.revisionState.kind === "accepted") {
              appendOperationHistoryEntry(
                createCommitSketchHistoryEntry(request, response.sketchId),
              );
            }
            return published;
          }
          return finalizeMutationResult(
            latestShared,
            response,
            result,
            input,
            () => createCommitSketchHistoryEntry(request, response.sketchId),
            "Edit Sketch",
          );
        },
      });
    },
    async projectSketchExternalReferences(input) {
      await ensureInitialized();
      await waitForRepositoryChanges();
      return adapter.projectSketchExternalReferences(
        withContractVersion<ProjectSketchExternalReferencesRequest>({
          ...input,
          documentId: currentDocumentId,
        }),
      );
    },
    addDocumentVariable(input) {
      return runLocalMutation({
        operation: "Add document variable",
        fallbackMessage: "Add document variable failed.",
        context: [{ key: "baseRevisionId", value: input.baseRevisionId }],
        action: async () => {
          const request = normalizeAddDocumentVariableInput(
            input,
            currentDocumentId,
          );
          const expected = await getMutationPredecessor();
          const response = await adapter.addDocumentVariable(request);
          return finalizeMutationResult(
            expected,
            response,
            mapDocumentVariableResponse(response, currentDocumentId),
            input,
            () =>
              createAddDocumentVariableHistoryEntry(
                request,
                response.variableId,
              ),
            "Add Variable",
          );
        },
      });
    },
    updateDocumentVariable(input) {
      return runLocalMutation({
        operation: "Update document variable",
        fallbackMessage: "Update document variable failed.",
        context: [
          { key: "baseRevisionId", value: input.baseRevisionId },
          { key: "variableId", value: input.variableId },
        ],
        action: async () => {
          const request = normalizeUpdateDocumentVariableInput(
            input,
            currentDocumentId,
          );
          const expected = await getMutationPredecessor();
          const response = await adapter.updateDocumentVariable(request);
          return finalizeMutationResult(
            expected,
            response,
            mapDocumentVariableResponse(response, currentDocumentId),
            input,
            () => createUpdateDocumentVariableHistoryEntry(request),
            "Edit Variable",
          );
        },
      });
    },
    removeDocumentVariable(input) {
      return runLocalMutation({
        operation: "Remove document variable",
        fallbackMessage: "Remove document variable failed.",
        context: [
          { key: "baseRevisionId", value: input.baseRevisionId },
          { key: "variableId", value: input.variableId },
        ],
        action: async () => {
          const request = normalizeRemoveDocumentVariableInput(
            input,
            currentDocumentId,
          );
          const expected = await getMutationPredecessor();
          const response = await adapter.removeDocumentVariable(request);
          return finalizeMutationResult(
            expected,
            response,
            mapDocumentVariableResponse(response, currentDocumentId),
            input,
            () => createRemoveDocumentVariableHistoryEntry(request),
            "Delete Variable",
          );
        },
      });
    },
    createFeature(input) {
      return runLocalMutation({
        operation: "Create feature",
        fallbackMessage: "Create feature failed.",
        context: [{ key: "baseRevisionId", value: input.baseRevisionId }],
        action: async () => {
          const request = normalizeCreateFeatureInput(input, currentDocumentId);
          const expected = await getMutationPredecessor();
          if (request.definition.kind === "extrude") {
            const selectionSnapshot = validateSnapshotResponse(
              await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
              currentDocumentId,
            );
            request.definition = enrichExtrudeRegionProfiles(
              request.definition,
              selectionSnapshot.document.sketches,
            );
          }
          const response = await adapter.createFeature(request);
          return finalizeMutationResult(
            expected,
            response,
            mapFeatureMutationResponse(response, currentDocumentId),
            input,
            () => createCreateFeatureHistoryEntry(request),
            // T17k2 (T17h finding): the action is named by its feature kind
            // ("Extrude"), not the repository default "Edit document".
            featureKindLabel(request.definition.kind),
          );
        },
      });
    },
    updateFeature(input) {
      return runLocalMutation({
        operation: "Update feature",
        fallbackMessage: "Update feature failed.",
        context: [
          { key: "baseRevisionId", value: input.baseRevisionId },
          { key: "featureId", value: input.featureId },
        ],
        action: async () => {
          const request = normalizeUpdateFeatureInput(input, currentDocumentId);
          const expected = await getMutationPredecessor();
          if (request.definition.kind === "extrude") {
            const selectionSnapshot = validateSnapshotResponse(
              await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
              currentDocumentId,
            );
            request.definition = enrichExtrudeRegionProfiles(
              request.definition,
              selectionSnapshot.document.sketches,
            );
          }
          const response = await adapter.updateFeature(request);
          return finalizeMutationResult(
            expected,
            response,
            mapFeatureMutationResponse(response, currentDocumentId),
            input,
            () => createUpdateFeatureHistoryEntry(request),
            `Edit ${featureKindLabel(request.definition.kind)}`,
          );
        },
      });
    },
    setFeatureSuppression(input) {
      return runLocalMutation({
        operation: input.suppressed ? "Suppress feature" : "Unsuppress feature",
        fallbackMessage: input.suppressed
          ? "Suppress feature failed."
          : "Unsuppress feature failed.",
        context: [
          { key: "baseRevisionId", value: input.baseRevisionId },
          { key: "featureId", value: input.featureId },
        ],
        action: async () => {
          const request = normalizeSetFeatureSuppressionInput(
            input,
            currentDocumentId,
          );
          const expected = await getMutationPredecessor();
          const response = await adapter.setFeatureSuppression(request);
          return finalizeMutationResult(
            expected,
            response,
            mapFeatureSuppressionResponse(response, currentDocumentId),
            input,
            () => createSetFeatureSuppressionHistoryEntry(request),
            request.suppressed ? "Suppress Feature" : "Unsuppress Feature",
          );
        },
      });
    },
    deleteFeature(input) {
      return runLocalMutation({
        operation: "Delete feature",
        fallbackMessage: "Delete feature failed.",
        context: [
          { key: "baseRevisionId", value: input.baseRevisionId },
          { key: "featureId", value: input.featureId },
        ],
        action: async () => {
          const request = normalizeDeleteFeatureInput(input, currentDocumentId);
          const expected = await getMutationPredecessor();
          const response = await adapter.deleteFeature(request);
          return finalizeMutationResult(
            expected,
            response,
            mapDeleteFeatureResponse(response, currentDocumentId),
            input,
            () => createDeleteFeatureHistoryEntry(request),
            "Delete Feature",
          );
        },
      });
    },
    deleteTarget(input) {
      return runLocalMutation({
        operation: "Delete target",
        fallbackMessage: "Delete target failed.",
        context: [
          { key: "baseRevisionId", value: input.baseRevisionId },
          { key: "target", value: getPrimitiveRefKey(input.target) },
        ],
        action: async () => {
          const request = normalizeDeleteTargetInput(input, currentDocumentId);
          const expected = await getMutationPredecessor();
          const response = await adapter.deleteTarget(request);
          return finalizeMutationResult(
            expected,
            response,
            mapDeleteTargetResponse(response, currentDocumentId),
            input,
            () => createDeleteTargetHistoryEntry(request),
            // T17e (P-8): a sketch delete is its own history entry; T17k2:
            // so is a body delete.
            request.target.kind === "sketch"
              ? "Delete Sketch"
              : request.target.kind === "body"
                ? "Delete Body"
                : undefined,
          );
        },
      });
    },
    renameBody(input) {
      return runLocalMutation({
        operation: "Rename body",
        fallbackMessage: "Rename body failed.",
        context: [
          { key: "baseRevisionId", value: input.baseRevisionId },
          { key: "bodyId", value: input.bodyId },
        ],
        action: async () => {
          const request = normalizeRenameBodyInput(input, currentDocumentId);
          const expected = await getMutationPredecessor();
          const response = await adapter.renameBody(request);
          return finalizeMutationResult(
            expected,
            response,
            mapRenameBodyResponse(response, currentDocumentId),
            input,
            () => createRenameBodyHistoryEntry(request),
            "Rename Body",
          );
        },
      });
    },
    renameFeature(input) {
      return runLocalMutation({
        operation: "Rename feature",
        fallbackMessage: "Rename feature failed.",
        context: [
          { key: "baseRevisionId", value: input.baseRevisionId },
          { key: "featureId", value: input.featureId },
        ],
        action: async () => {
          const request = normalizeRelabelInput(input, currentDocumentId);
          const expected = await getMutationPredecessor();
          const response = await adapter.renameFeature(request);
          const feature = expected.features.find(
            (entry) => entry.featureId === request.featureId,
          );
          // Recorded as the update it replaces, whose replay is equivalent.
          return finalizeMutationResult(
            expected,
            response,
            mapFeatureMutationResponse(response, currentDocumentId),
            input,
            feature
              ? () =>
                  createUpdateFeatureHistoryEntry({
                    ...request,
                    definition: feature.definition,
                  })
              : null,
            feature && `Edit ${featureKindLabel(feature.definition.kind)}`,
          );
        },
      });
    },
    renameSketch(input) {
      return runLocalMutation({
        operation: "Rename sketch",
        fallbackMessage: "Rename sketch failed.",
        context: [
          { key: "baseRevisionId", value: input.baseRevisionId },
          { key: "sketchId", value: input.sketchId },
        ],
        action: async () => {
          const request = normalizeRelabelInput(input, currentDocumentId);
          const expected = await getMutationPredecessor();
          const response = await adapter.renameSketch(request);
          const sketch = expected.sketches.find(
            (entry) => entry.sketchId === request.sketchId,
          );
          // Recorded as the commit it replaces, whose replay is equivalent.
          return finalizeMutationResult(
            expected,
            response,
            mapCommitSketchResponse(response, currentDocumentId),
            input,
            sketch
              ? () =>
                  createCommitSketchHistoryEntry(
                    {
                      ...request,
                      solverCorrelation: null,
                      plane: sketch.plane,
                      definition: sketch.definition,
                    },
                    request.sketchId,
                  )
              : null,
            "Edit Sketch",
          );
        },
      });
    },
    setBodyAppearance(input) {
      return runLocalMutation({
        operation: "Change body color",
        fallbackMessage: "Change body color failed.",
        context: [
          { key: "baseRevisionId", value: input.baseRevisionId },
          { key: "bodyId", value: input.bodyId },
        ],
        action: async () => {
          const request = normalizeSetBodyAppearanceInput(
            input,
            currentDocumentId,
          );
          const expected = await getMutationPredecessor();
          const response = await adapter.setBodyAppearance(request);
          return finalizeMutationResult(
            expected,
            response,
            mapSetBodyAppearanceResponse(response, currentDocumentId),
            input,
            () => createSetBodyAppearanceHistoryEntry(request),
            "Change Body Color",
          );
        },
      });
    },
    reorderFeature(input) {
      return runLocalMutation({
        operation: "Reorder feature",
        fallbackMessage: "Reorder feature failed.",
        context: [
          { key: "baseRevisionId", value: input.baseRevisionId },
          { key: "featureId", value: input.featureId },
        ],
        action: async () => {
          const request = normalizeReorderFeatureInput(
            input,
            currentDocumentId,
          );
          const expected = await getMutationPredecessor();
          const response = await adapter.reorderFeature(request);
          return finalizeMutationResult(
            expected,
            response,
            mapReorderFeatureResponse(response, currentDocumentId),
            input,
            () => createReorderFeatureHistoryEntry(request),
            "Reorder History",
          );
        },
      });
    },
    reorderDocumentHistory(input) {
      return runLocalMutation({
        operation: "Reorder document history",
        fallbackMessage: "Reorder document history failed.",
        context: [
          { key: "baseRevisionId", value: input.baseRevisionId },
          {
            key: "item",
            value:
              input.item.kind === "sketch"
                ? input.item.sketchId
                : input.item.featureId,
          },
        ],
        action: async () => {
          const request = normalizeReorderDocumentHistoryInput(
            input,
            currentDocumentId,
          );
          const expected = await getMutationPredecessor();
          const response = await adapter.reorderDocumentHistory(request);
          return finalizeMutationResult(
            expected,
            response,
            mapReorderDocumentHistoryResponse(response, currentDocumentId),
            input,
            () => createReorderDocumentHistoryEntry(request),
            "Reorder History",
          );
        },
      });
    },
    setFeatureCursor(input) {
      return runLocalMutation({
        operation: "Set feature cursor",
        fallbackMessage: "Set feature cursor failed.",
        context: [{ key: "baseRevisionId", value: input.baseRevisionId }],
        action: async () => {
          const request = normalizeSetFeatureCursorInput(
            input,
            currentDocumentId,
          );
          const expected = await getMutationPredecessor();
          const response = await adapter.setFeatureCursor(request);
          return finalizeMutationResult(
            expected,
            response,
            mapSetFeatureCursorResponse(response, currentDocumentId),
            input,
            input.persistHistory === false
              ? null
              : () => createSetFeatureCursorHistoryEntry(request),
            "Roll History",
          );
        },
      });
    },
    async evaluatePreview(input) {
      await ensureInitialized();
      await waitForRepositoryChanges();
      const response = await adapter.evaluatePreview(
        normalizePreviewInput(input, currentDocumentId),
      );

      return mapPreviewResponse(response, currentDocumentId);
    },
    async exportDocument(input) {
      await ensureInitialized();
      await waitForRepositoryChanges();
      const request = normalizeExportDocumentInput(input, currentDocumentId);

      if (request.format !== "cadara") {
        const capabilitiesOrDiagnostic = await adapter.getExportCapabilities(
          request.baseRevisionId,
        );

        if ("code" in capabilitiesOrDiagnostic) {
          const failure: DocumentExportResult = {
            ok: false,
            format: request.format,
            diagnostics: [capabilitiesOrDiagnostic],
          };
          return mapExportDocumentResponse(failure);
        }

        const { target } = request;
        const targetAppearance =
          target.kind === "body"
            ? (validateSnapshotResponse(
                await adapter.getDocumentSnapshot(
                  buildDocumentRequest(currentDocumentId),
                ),
                currentDocumentId,
              ).document.bodies.find((body) => body.bodyId === target.bodyId)
                ?.appearance ?? null)
            : null;

        return mapExportDocumentResponse(
          await orchestrateGeometryExport(
            {
              format: request.format,
              options: request.options,
              target,
              targetLabel: request.targetLabel,
              targetAppearance,
            },
            capabilitiesOrDiagnostic,
            exportProviders,
          ),
        );
      }

      const snapshot = await validateSnapshotResponse(
        await adapter.getDocumentSnapshot(
          buildDocumentRequest(currentDocumentId),
        ),
        currentDocumentId,
      );

      if (request.baseRevisionId !== snapshot.document.revisionId) {
        return {
          ok: false,
          format: request.format,
          diagnostics: [
            createExportDiagnostic(
              "export-revision-conflict",
              `Export request revision ${request.baseRevisionId} does not match current revision ${snapshot.document.revisionId}.`,
              request.target,
            ),
          ],
        };
      }

      const cadaraOptions = requireCadaraExportOptions(request.options);

      return mapExportDocumentResponse({
        ok: true,
        format: request.format,
        filename: createExportFilename(request.targetLabel, request.format),
        extension: "cadara",
        mimeType: "application/vnd.cadara+json",
        payload: stringifyCadaraDocument(
          snapshot.document,
          cadaraOptions.pretty,
        ),
        diagnostics: [],
      });
    },
    async resolveReference(target) {
      await ensureInitialized();
      await waitForRepositoryChanges();
      const response = await adapter.resolveReference(
        normalizeResolveReferenceInput(target, currentDocumentId),
      );

      const normalized = mapResolvedReferenceResponse(
        response,
        currentDocumentId,
      );
      return {
        ...normalized,
        resolution: {
          ...normalized.resolution,
          label: getResolutionLabel(normalized.resolution),
        },
      };
    },
    async measureTopology(targets) {
      await ensureInitialized();
      await waitForRepositoryChanges();
      if (!adapter.measureTopology) return null;
      return requireMeasureTopologyResponse(
        await adapter.measureTopology({
          contractVersion: CONTRACT_VERSION,
          documentId: currentDocumentId,
          targets: [...targets],
        }),
      );
    },
  };
}
