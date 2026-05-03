import type { GeometryAssetResolver, ModelingKernelAdapter } from '@/contracts/modeling/adapter'
import type { DocumentExportResult } from '@/contracts/modeling/export'
import { orchestrateGeometryExport } from '@/domain/export/export-orchestrator'
import { createExportProviderRegistry } from '@/domain/export/provider-registry'
import type {
  PrimitiveRef,
  RevisionId,
} from '@/core/editor/schema'
import {
  getPrimitiveRefKey,
} from '@/core/editor/schema'
import type {
  WorkspaceSnapshot,
  ModelingDiagnostic,
  ModelingOperationResult,
  MutationRevisionState,
  RebuildResult,
} from '@/contracts/modeling/schema'
import type { GeometryAssetBlobInput, GeometryAssetHash } from '@/contracts/modeling/geometry-assets'
import {
  encodeGeometryAssetData,
  createGeometryAssetDiagnostic,
} from '@/contracts/modeling/geometry-assets'
import {
  cadaraExportOptionsSchema,
} from '@/contracts/modeling/export.runtime-schema'
import {
  createAuthoredModelDocumentFromSnapshot,
  type AuthoredModelDocument,
} from '@/contracts/modeling/authored-document'
import { parseAuthoredModelDocument } from '@/contracts/modeling/authored-document.runtime-schema'
import {
  createCommitSketchHistoryEntry,
  createAddDocumentVariableHistoryEntry,
  createCreateFeatureHistoryEntry,
  createDeleteFeatureHistoryEntry,
  createDeleteTargetHistoryEntry,
  createEmptyOperationHistory,
  createRenameBodyHistoryEntry,
  createReorderDocumentHistoryEntry,
  createReorderFeatureHistoryEntry,
  createSetFeatureCursorHistoryEntry,
  createUpdateDocumentVariableHistoryEntry,
  createUpdateFeatureHistoryEntry,
  type ModelingOperationHistoryEntry,
  type ModelingOperationHistoryPayload,
} from '@/contracts/modeling/operation-history'
import type { ProjectSketchExternalReferencesRequest } from '@/contracts/solver/schema'
import {
  loadOrCreateOperationHistory,
} from '@/domain/modeling/modeling-history-persistence'
import {
  isLocalFileSyncDocumentRepository,
  isGeometryAssetDocumentRepository,
  type DocumentRepositoryChangeEvent,
  type DocumentRepositoryMetadata,
} from '@/domain/modeling/document-repository'
import {
  createLocalAuthoredDocumentPayload,
} from '@/lib/local-file-system-access'
import { hashGeometryAssetBytes } from '@/domain/modeling/geometry-asset-store'
import type {
  ModelingService,
  ModelingServiceOptions,
  ModelingServiceDocumentChangeEvent,
  ModelingHistoryRestoreState,
  ModelingDocumentFileMutationResult,
} from './types'
import { createSketchSolverService } from './sketch-solver'
import {
  withContractVersion,
  sameStringSet,
  collectMissingFeatureSketchDependencyIds,
  normalizeCurrentDocumentId,
  normalizeCommitSketchInput,
  normalizeAddDocumentVariableInput,
  normalizeUpdateDocumentVariableInput,
  normalizeCreateFeatureInput,
  normalizeUpdateFeatureInput,
  normalizeDeleteFeatureInput,
  normalizeDeleteTargetInput,
  normalizeRenameBodyInput,
  normalizeReorderFeatureInput,
  normalizeReorderDocumentHistoryInput,
  normalizeSetFeatureCursorInput,
  normalizePreviewInput,
  normalizeResolveReferenceInput,
  normalizeExportDocumentInput,
  isAcceptedMutation,
  createRestoreFailure,
  createRepositoryRestoreFailure,
  createDocumentRepositoryDiagnostic,
  runModelingMutationBoundary,
  getResolutionLabel,
  createExportDiagnostic,
  createExportFilename,
  stringifyCadaraDocument,
} from './helpers'
import {
  normalizeRevisionState,
  normalizePreviewFreshness,
  normalizeRebuildResult,
  normalizeFeatureTree,
  normalizeObjects,
  normalizeReferences,
  normalizeDocumentVariables,
  normalizeRenderables,
  normalizeSketches,
  normalizeFeatures,
  normalizeDocumentFeatureCursor,
  normalizeBodies,
  normalizeConstructions,
  normalizeEntities,
} from './normalization'
import {
  validateSnapshotResponse,
  buildDocumentRequest,
  mapCommitSketchResponse,
  mapDocumentVariableResponse,
  mapFeatureMutationResponse,
  mapDeleteFeatureResponse,
  mapDeleteTargetResponse,
  mapRenameBodyResponse,
  mapReorderFeatureResponse,
  mapReorderDocumentHistoryResponse,
  mapSetFeatureCursorResponse,
  mapPreviewResponse,
  mapExportDocumentResponse,
  mapResolvedReferenceResponse,
  normalizeResolution,
} from './snapshot'
import {
  getAdapterReplayCursor,
  replayHistoryEntry,
} from './operation-history'
import { renderExportSchema } from '@/contracts/render/runtime-schema'

export function createModelingService(
  adapter: ModelingKernelAdapter,
  options: ModelingServiceOptions,
): ModelingService {
  const exportProviders = options.exportProviders ?? createExportProviderRegistry([])
  const currentDocumentId = normalizeCurrentDocumentId(options.currentDocumentId)
  const sketchSolver = options.sketchSolver ? createSketchSolverService(options.sketchSolver) : null
  const operationHistoryStore = options.operationHistoryStore ?? null
  const documentRepository = options.documentRepository ?? null
  const documentRepositoryPersistence = options.documentRepositoryPersistence ?? 'blocking'
  let operationHistoryPayload: ModelingOperationHistoryPayload = createEmptyOperationHistory(currentDocumentId)
  let operationHistoryGeneration = 0
  let canPersistOperationHistory = true
  let canPersistAuthoredDocument = true
  let historyRestoreState: ModelingHistoryRestoreState = {
    kind: 'pending',
    entriesReplayed: 0,
    diagnostics: [],
  }
  let currentRepositoryMetadata: DocumentRepositoryMetadata | null = null
  let latestDocumentChangeEvent: ModelingServiceDocumentChangeEvent | null = null
  let seedAuthoredDocument: AuthoredModelDocument | null = null
  let repositoryChangePromise = Promise.resolve()
  let repositoryPersistencePromise = Promise.resolve()
  let isRestoringRepositoryDocument = documentRepository !== null
  const documentChangeListeners = new Set<(event: ModelingServiceDocumentChangeEvent) => void>()

  function rememberRepositoryMetadata(metadata: DocumentRepositoryMetadata) {
    currentRepositoryMetadata = {
      ...metadata,
      heads: [...metadata.heads],
    }
  }

  function markRepositorySnapshotFresh(metadata: DocumentRepositoryMetadata) {
    rememberRepositoryMetadata(metadata)
  }

  function createEmptyOperationHistoryForCurrentRepository() {
    return createEmptyOperationHistory(currentDocumentId, currentRepositoryMetadata?.heads)
  }

  function resetOperationHistoryPayloadForCurrentRepository() {
    operationHistoryPayload = createEmptyOperationHistoryForCurrentRepository()
    operationHistoryGeneration += 1
  }

  function canReplayOperationHistoryOverRestoredRepository(
    historyPayload: ModelingOperationHistoryPayload,
    restoredDocument: AuthoredModelDocument,
    seedDocument: AuthoredModelDocument,
    restoredMetadata: DocumentRepositoryMetadata,
  ) {
    return authoredDocumentsEqual(restoredDocument, seedDocument)
      || (
        historyPayload.baseRepositoryHeads !== undefined
        && sameStringSet(historyPayload.baseRepositoryHeads, restoredMetadata.heads)
      )
      || canOperationHistoryRepairMissingSketchDependencies(historyPayload, restoredDocument)
  }

  function canOperationHistoryRepairMissingSketchDependencies(
    historyPayload: ModelingOperationHistoryPayload,
    restoredDocument: AuthoredModelDocument,
  ) {
    const missingSketchIds = collectMissingFeatureSketchDependencyIds(restoredDocument)
    if (missingSketchIds.size === 0) {
      return false
    }

    const replayedSketchIds = new Set(
      historyPayload.entries
        .filter((entry): entry is Extract<ModelingOperationHistoryEntry, { kind: 'commitSketch' }> => entry.kind === 'commitSketch')
        .map((entry) => entry.payload.sketchId),
    )

    return [...missingSketchIds].every((sketchId) => replayedSketchIds.has(sketchId))
  }

  function attachRepositoryProvenance(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
    const metadata = documentRepository ? currentRepositoryMetadata ?? documentRepository.getMetadata(currentDocumentId) : null
    if (!metadata) {
      return {
        ...snapshot,
        provenance: null,
      }
    }

    return {
      ...snapshot,
      provenance: {
        repositoryHeads: [...metadata.heads],
        repositorySource: metadata.source,
      },
    }
  }

  function repositoryHeadsChangedSinceBasis(input: { baseRepositoryHeads?: readonly string[] }) {
    if (!currentRepositoryMetadata || !input.baseRepositoryHeads) {
      return false
    }

    if (currentRepositoryMetadata.source !== 'peer') {
      return false
    }

    return !sameStringSet(currentRepositoryMetadata.heads, input.baseRepositoryHeads)
  }

  function addRepositoryFreshnessDiagnostic<T extends { revisionState: MutationRevisionState; diagnostics: ModelingDiagnostic[] }>(
    result: T,
    input: { baseRepositoryHeads?: readonly string[] },
  ): T {
    if (!repositoryHeadsChangedSinceBasis(input)) {
      return result
    }

    return {
      ...result,
      diagnostics: [
        ...result.diagnostics,
        {
          code: 'repository-head-conflict',
          severity: 'error',
          message: 'The authored document changed after the current snapshot was loaded. Refresh before retrying this mutation.',
          target: null,
          detail: null,
        },
      ],
    }
  }

  async function restoreAuthoredRepositoryDocument(
    document: Parameters<NonNullable<ModelingKernelAdapter['restoreAuthoredModelDocument']>>[0],
    diagnostics: ModelingDiagnostic[] = [],
    assets: readonly GeometryAssetBlobInput[] = [],
  ) {
    await adapter.restoreAuthoredModelDocument?.(
      document,
      diagnostics,
      createLocalAssetResolver(assets),
    )
  }

  async function getSeedAuthoredDocument() {
    if (seedAuthoredDocument) {
      return structuredClone(seedAuthoredDocument)
    }

    const seedSnapshot = validateSnapshotResponse(
      await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
      currentDocumentId,
    )
    seedAuthoredDocument = createAuthoredModelDocumentFromSnapshot(seedSnapshot)
    return structuredClone(seedAuthoredDocument)
  }

  function authoredDocumentsEqual(
    left: AuthoredModelDocument,
    right: AuthoredModelDocument,
  ) {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  async function exportAuthoredDocumentForRepository() {
    if (adapter.exportAuthoredModelDocument) {
      return adapter.exportAuthoredModelDocument(currentDocumentId)
    }

    const snapshot = validateSnapshotResponse(
      await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
      currentDocumentId,
    )
    return createAuthoredModelDocumentFromSnapshot(snapshot)
  }

  function createDocumentFileDiagnostic(code: string, message: string): ModelingDiagnostic {
    return {
      code,
      severity: 'error',
      message,
      target: null,
      detail: null,
    }
  }

  function createLocalAssetResolver(assets: readonly GeometryAssetBlobInput[]): GeometryAssetResolver | undefined {
    const transientAssetBytes = new Map<GeometryAssetHash, Uint8Array>()
    for (const asset of assets) {
      transientAssetBytes.set(asset.asset.hash, asset.bytes.slice())
    }

    const repositoryResolver = isGeometryAssetDocumentRepository(documentRepository)
      ? documentRepository
      : undefined

    if (transientAssetBytes.size === 0) {
      return repositoryResolver
    }

    return {
      async getGeometryAssetBytes(hash) {
        const bytes = transientAssetBytes.get(hash)
        if (bytes) {
          return bytes.slice()
        }

        return repositoryResolver?.getGeometryAssetBytes(hash) ?? null
      },
    }
  }

  async function validateEmbeddedGeometryAssetsForPersistence(
    document: AuthoredModelDocument,
    assets: readonly GeometryAssetBlobInput[],
  ) {
    const diagnostics: ModelingDiagnostic[] = []
    const providedAssetsById = new Map(assets.map((asset) => [asset.asset.assetId, asset]))

    for (const asset of document.assets.records) {
      if (asset.format !== 'cadara-brep' && asset.format !== 'baked-mesh') {
        continue
      }

      if (!asset.data) {
        diagnostics.push(createGeometryAssetDiagnostic(
          'geometry-asset-corrupt',
          asset,
          `Geometry asset ${asset.assetId} is missing embedded authored geometry data.`,
        ))
        continue
      }

      const embeddedBytes = encodeGeometryAssetData(asset.data)
      const embeddedHash = await hashGeometryAssetBytes(embeddedBytes)
      if (embeddedBytes.byteLength !== asset.byteLength || embeddedHash !== asset.hash) {
        diagnostics.push(createGeometryAssetDiagnostic(
          'geometry-asset-corrupt',
          asset,
          `Geometry asset ${asset.assetId} embedded data does not match its recorded hash or byte length.`,
        ))
      }

      const providedAsset = providedAssetsById.get(asset.assetId)
      if (providedAsset) {
        const providedHash = await hashGeometryAssetBytes(providedAsset.bytes)
        if (
          providedAsset.asset.hash !== asset.hash
          || providedAsset.asset.byteLength !== asset.byteLength
          || providedAsset.bytes.byteLength !== asset.byteLength
          || providedHash !== asset.hash
        ) {
          diagnostics.push(createGeometryAssetDiagnostic(
            'geometry-asset-corrupt',
            asset,
            `Geometry asset ${asset.assetId} prepared bytes do not match its embedded authored geometry data.`,
          ))
        }
      }
    }

    return diagnostics
  }

  type AuthoredDocumentValidationResult =
    | { ok: true; document: AuthoredModelDocument }
    | { ok: false; diagnostics: ModelingDiagnostic[] }

  function normalizeImportedDocument(value: unknown): AuthoredDocumentValidationResult {
    const parsed = parseAuthoredModelDocument(structuredClone(value))

    if (!parsed.ok) {
      return {
        ok: false,
        diagnostics: [
          createDocumentFileDiagnostic(
            `document-import-${parsed.diagnostic.reasonCode}`,
            parsed.diagnostic.message,
          ),
        ],
      }
    }

    return {
      ok: true,
      document: {
        ...parsed.document,
        documentId: currentDocumentId,
      },
    }
  }

  async function replaceCurrentAuthoredDocument(
    document: AuthoredModelDocument,
    assets: readonly GeometryAssetBlobInput[] = [],
    options: { fetchSnapshot?: boolean; validateBeforePersist?: boolean; validateEmbeddedAssetsBeforePersist?: boolean } = {},
  ): Promise<ModelingDocumentFileMutationResult> {
    if (!adapter.restoreAuthoredModelDocument) {
      return {
        ok: false,
        diagnostics: [
          createDocumentFileDiagnostic(
            'document-import-unsupported-adapter',
            'The active modeling adapter cannot restore authored documents.',
          ),
        ],
      }
    }

    const normalized = normalizeImportedDocument(document)
    if (!normalized.ok) {
      return normalized
    }

    const activeDocument = normalized.document
    let restoreDiagnostics: ModelingDiagnostic[] = []
    const rollbackDocument = options.validateBeforePersist && documentRepository
      ? await exportAuthoredDocumentForRepository()
      : null

    const restoreActiveDocument = async () => {
      await restoreAuthoredRepositoryDocument(activeDocument, restoreDiagnostics, assets)
    }

    const validateActiveDocument = async () => {
      await (
        adapter.validateAuthoredModelDocument?.(
          activeDocument,
          restoreDiagnostics,
          createLocalAssetResolver(assets),
        ) ?? restoreActiveDocument()
      )
    }

    if (options.validateBeforePersist) {
      try {
        await validateActiveDocument()
      } catch (error: unknown) {
        return {
          ok: false,
          diagnostics: [
            createDocumentFileDiagnostic(
              'document-import-restore-failed',
              error instanceof Error ? error.message : 'Imported document could not be restored.',
            ),
          ],
        }
      }
    }

    if (options.validateEmbeddedAssetsBeforePersist) {
      const diagnostics = await validateEmbeddedGeometryAssetsForPersistence(activeDocument, assets)
      if (diagnostics.length > 0) {
        return {
          ok: false,
          diagnostics,
        }
      }
    }

    if (documentRepository) {
      const writeResult = await documentRepository.mutate({
        documentId: currentDocumentId,
        document: activeDocument,
        assets,
      })

      if (!writeResult.ok) {
        canPersistAuthoredDocument = false
        if (rollbackDocument) {
          await restoreAuthoredRepositoryDocument(rollbackDocument)
        }
        return {
          ok: false,
          diagnostics: [createDocumentRepositoryDiagnostic(writeResult.status)],
        }
      }

      markRepositorySnapshotFresh(writeResult.metadata)
      restoreDiagnostics = writeResult.diagnostics ?? []
    }

    if (!options.validateBeforePersist) {
      await restoreActiveDocument()
    }
    operationHistoryStore?.clear()
    resetOperationHistoryPayloadForCurrentRepository()
    canPersistOperationHistory = true
    canPersistAuthoredDocument = true
    historyRestoreState = { kind: 'restored', entriesReplayed: 0, diagnostics: [] }

    if (options.fetchSnapshot === false) {
      return {
        ok: true,
        revisionId: activeDocument.revisionId,
        diagnostics: restoreDiagnostics,
      }
    }

    const snapshot = validateSnapshotResponse(
      await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
      currentDocumentId,
    )

    return {
      ok: true,
      revisionId: snapshot.document.revisionId,
      diagnostics: snapshot.document.diagnostics,
    }
  }

  async function createRepositoryHeadConflictResult<
    T extends {
      revisionId: RevisionId
      revisionState: MutationRevisionState
      rebuildResult: RebuildResult
      changedTargets: PrimitiveRef[]
      diagnostics: ModelingDiagnostic[]
    },
  >(result: T, input: { baseRepositoryHeads?: readonly string[] }): Promise<T> {
    await repositoryChangePromise
    const snapshot = validateSnapshotResponse(
      await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
      currentDocumentId,
    )
    const diagnostics = result.diagnostics.some((diagnostic) => diagnostic.code === 'repository-head-conflict')
      ? result.diagnostics
      : addRepositoryFreshnessDiagnostic(result, input).diagnostics
    const expectedRevisionId = result.revisionState.kind === 'accepted'
      ? result.revisionState.baseRevisionId
      : result.revisionId

    return {
      ...result,
      revisionId: snapshot.document.revisionId,
      revisionState: {
        kind: 'conflict',
        expectedRevisionId,
        actualRevisionId: snapshot.document.revisionId,
      },
      rebuildResult: {
        kind: 'skipped',
        reasonCode: 'revisionConflict',
        invalidatedTargets: [],
        diagnostics,
      },
      changedTargets: [],
      diagnostics,
    }
  }

  async function finalizeMutationResult<T extends {
    revisionId: RevisionId
    revisionState: MutationRevisionState
    rebuildResult: RebuildResult
    changedTargets: PrimitiveRef[]
    diagnostics: ModelingDiagnostic[]
  }>(
    response: ModelingOperationResult,
    result: T,
    input: { baseRepositoryHeads?: readonly string[] },
    createHistoryEntry: (() => ModelingOperationHistoryEntry) | null,
  ): Promise<T> {
    const repositoryConflict = repositoryHeadsChangedSinceBasis(input)
    const freshResult = repositoryConflict ? addRepositoryFreshnessDiagnostic(result, input) : result

    if (!isAcceptedMutation(response)) {
      return freshResult
    }

    if (repositoryConflict) {
      return createRepositoryHeadConflictResult(freshResult, input)
    }

    if (createHistoryEntry) {
      appendOperationHistoryEntry(createHistoryEntry())
      if (documentRepositoryPersistence === 'background') {
        enqueueAcceptedAuthoredDocumentPersistence()
        return freshResult
      }
    } else if (documentRepositoryPersistence === 'background') {
      enqueueAcceptedAuthoredDocumentPersistence()
      return freshResult
    }

    return persistAcceptedAuthoredDocument(freshResult)
  }

  function notifyModelingDocumentChange(event: DocumentRepositoryChangeEvent) {
    const serviceEvent: ModelingServiceDocumentChangeEvent = {
      documentId: currentDocumentId,
      metadata: event.metadata,
    }
    latestDocumentChangeEvent = {
      documentId: serviceEvent.documentId,
      metadata: {
        ...serviceEvent.metadata,
        heads: [...serviceEvent.metadata.heads],
      },
    }
    for (const listener of documentChangeListeners) {
      listener(latestDocumentChangeEvent)
    }
  }

  const unsubscribeDocumentRepository = documentRepository?.subscribe(currentDocumentId, (event) => {
    rememberRepositoryMetadata(event.metadata)
    if (event.metadata.source !== 'peer') {
      if (isRestoringRepositoryDocument) {
        return
      }

      notifyModelingDocumentChange(event)
      return
    }

    repositoryChangePromise = repositoryChangePromise.then(async () => {
      await restorePromise
      rememberRepositoryMetadata(event.metadata)
      await restoreAuthoredRepositoryDocument(event.document, event.diagnostics)
      notifyModelingDocumentChange(event)
    })
  })

  async function replayOperationHistoryPayload(loadResultPayload: ModelingOperationHistoryPayload) {
    operationHistoryPayload = structuredClone(loadResultPayload)
    operationHistoryGeneration = loadResultPayload.entries.length
    let replayCursor = await getAdapterReplayCursor(adapter, currentDocumentId)

    for (const [entryIndex, entry] of loadResultPayload.entries.entries()) {
      const { response, cursor } = await replayHistoryEntry({
        adapter,
        documentId: currentDocumentId,
        entry,
        entryIndex,
        cursor: replayCursor,
      })
      replayCursor = cursor

      if (!isAcceptedMutation(response)) {
        canPersistOperationHistory = false
        historyRestoreState = createRestoreFailure(
          response.revisionState.kind === 'rejected'
            ? response.revisionState.reasonCode
            : 'revision-conflict',
          `Operation history replay failed at entry ${entryIndex}.`,
          entryIndex,
          entryIndex,
        )
        return
      }

      historyRestoreState = {
        kind: 'restored',
        entriesReplayed: entryIndex + 1,
        diagnostics: [],
      }
    }

    historyRestoreState = loadResultPayload.entries.length === 0
      ? { kind: 'empty', entriesReplayed: 0, diagnostics: [] }
      : {
          kind: 'restored',
          entriesReplayed: loadResultPayload.entries.length,
          diagnostics: [],
        }
  }

  async function restoreOperationHistoryCompatibility() {
    await getSeedAuthoredDocument()
    const loadResult = loadOrCreateOperationHistory(operationHistoryStore, currentDocumentId)

    if (!loadResult.ok) {
      canPersistOperationHistory = false
      historyRestoreState = createRestoreFailure(loadResult.reasonCode, loadResult.message, null, 0)
      return
    }

    if (loadResult.payload.documentId !== currentDocumentId) {
      canPersistOperationHistory = false
      historyRestoreState = createRestoreFailure(
        'document-id-mismatch',
        'Operation history document identity does not match the active document.',
        null,
        0,
      )
      return
    }

    if (loadResult.payload.baseRepositoryHeads !== undefined) {
      canPersistOperationHistory = false
      historyRestoreState = { kind: 'empty', entriesReplayed: 0, diagnostics: [] }
      return
    }

    await replayOperationHistoryPayload(loadResult.payload)
  }

  async function restoreRepositoryBackedDocument() {
    const seedDocument = await getSeedAuthoredDocument()
    const loadResult = await documentRepository!.load({
      documentId: currentDocumentId,
      seedDocument,
    })

    if (!loadResult.ok) {
      canPersistOperationHistory = false
      canPersistAuthoredDocument = false
      historyRestoreState = createRepositoryRestoreFailure(loadResult.status)
      return
    }

    rememberRepositoryMetadata(loadResult.metadata)

    const historyLoadResult = operationHistoryStore?.load()

    if (loadResult.status.kind === 'restored') {
      await restoreAuthoredRepositoryDocument(loadResult.document, loadResult.diagnostics)
      if (
        historyLoadResult?.ok
        && historyLoadResult.payload
        && historyLoadResult.payload.entries.length > 0
        && historyLoadResult.payload.documentId === currentDocumentId
        && canReplayOperationHistoryOverRestoredRepository(
          historyLoadResult.payload,
          loadResult.document,
          seedDocument,
          loadResult.metadata,
        )
      ) {
        await replayOperationHistoryPayload(historyLoadResult.payload)
        if (historyRestoreState.kind === 'failed') {
          canPersistAuthoredDocument = false
          return
        }

        const writeResult = await documentRepository!.mutate({
          documentId: currentDocumentId,
          document: await exportAuthoredDocumentForRepository(),
        })
        if (!writeResult.ok) {
          canPersistOperationHistory = false
          canPersistAuthoredDocument = false
          historyRestoreState = createRepositoryRestoreFailure(writeResult.status, historyRestoreState.entriesReplayed)
          return
        }

        markRepositorySnapshotFresh(writeResult.metadata)
        operationHistoryStore?.clear()
        resetOperationHistoryPayloadForCurrentRepository()
        return
      }

      resetOperationHistoryPayloadForCurrentRepository()
      historyRestoreState = { kind: 'restored', entriesReplayed: 0, diagnostics: [] }
      return
    }

    if (historyLoadResult && !historyLoadResult.ok) {
      operationHistoryStore?.clear()
      resetOperationHistoryPayloadForCurrentRepository()
      historyRestoreState = { kind: 'empty', entriesReplayed: 0, diagnostics: [] }
      return
    }

    if (historyLoadResult?.payload && historyLoadResult.payload.entries.length > 0) {
      if (historyLoadResult.payload.documentId !== currentDocumentId) {
        await documentRepository!.reset(currentDocumentId)
        canPersistOperationHistory = false
        canPersistAuthoredDocument = false
        historyRestoreState = createRestoreFailure(
          'document-id-mismatch',
          'Operation history document identity does not match the active document.',
          null,
          0,
        )
        return
      }

      await replayOperationHistoryPayload(historyLoadResult.payload)
      if (historyRestoreState.kind === 'failed') {
        await documentRepository!.reset(currentDocumentId)
        canPersistAuthoredDocument = false
        return
      }

      const writeResult = await documentRepository!.mutate({
        documentId: currentDocumentId,
        document: await exportAuthoredDocumentForRepository(),
      })
      if (!writeResult.ok) {
        await documentRepository!.reset(currentDocumentId)
        canPersistOperationHistory = false
        canPersistAuthoredDocument = false
        historyRestoreState = createRepositoryRestoreFailure(writeResult.status, historyRestoreState.entriesReplayed)
      }
      if (writeResult.ok) {
        markRepositorySnapshotFresh(writeResult.metadata)
        operationHistoryStore?.clear()
        resetOperationHistoryPayloadForCurrentRepository()
      }
      return
    }

    resetOperationHistoryPayloadForCurrentRepository()
    historyRestoreState = { kind: 'empty', entriesReplayed: 0, diagnostics: [] }
  }

  const restorePromise = (async () => {
    if (documentRepository) {
      await restoreRepositoryBackedDocument()
      return
    }

    await restoreOperationHistoryCompatibility()
  })().catch((error: unknown) => {
    canPersistOperationHistory = false
    canPersistAuthoredDocument = false
    historyRestoreState = createRestoreFailure(
      'replay-exception',
      error instanceof Error ? error.message : 'Operation history replay failed unexpectedly.',
      historyRestoreState.entriesReplayed,
      historyRestoreState.entriesReplayed,
    )
  }).finally(() => {
    isRestoringRepositoryDocument = false
  })

  function resetOperationHistory() {
    operationHistoryStore?.clear()
    void documentRepository?.reset(currentDocumentId)
    repositoryPersistencePromise = Promise.resolve()
    operationHistoryPayload = createEmptyOperationHistory(currentDocumentId)
    operationHistoryGeneration += 1
    canPersistOperationHistory = true
    canPersistAuthoredDocument = true
    historyRestoreState = {
      kind: 'empty',
      entriesReplayed: 0,
      diagnostics: [],
    }
  }

  function appendOperationHistoryEntry(entry: ModelingOperationHistoryEntry): number | null {
    if (!operationHistoryStore || !canPersistOperationHistory) {
      return null
    }

    operationHistoryPayload = {
      ...operationHistoryPayload,
      entries: [...operationHistoryPayload.entries, structuredClone(entry)],
    }

    try {
      operationHistoryStore.save(operationHistoryPayload)
      operationHistoryGeneration += 1
      return operationHistoryGeneration
    } catch (error: unknown) {
      canPersistOperationHistory = false
      historyRestoreState = createRestoreFailure(
        'history-write-failed',
        error instanceof Error ? error.message : 'Operation history could not be written.',
        null,
        operationHistoryPayload.entries.length,
      )
      return null
    }
  }

  async function persistAcceptedAuthoredDocument<T extends { diagnostics: ModelingDiagnostic[] }>(result: T): Promise<T> {
    if (!documentRepository) {
      return result
    }

    if (!canPersistAuthoredDocument) {
      const status = documentRepository.getRestoreStatus(currentDocumentId)
      return status.kind === 'failed'
        ? {
            ...result,
            diagnostics: [...result.diagnostics, createDocumentRepositoryDiagnostic(status)],
          }
        : result
    }

    const writeResult = await documentRepository.mutate({
      documentId: currentDocumentId,
      document: await exportAuthoredDocumentForRepository(),
    })

    if (writeResult.ok) {
      markRepositorySnapshotFresh(writeResult.metadata)
      return result
    }

    canPersistAuthoredDocument = false
    return {
      ...result,
      diagnostics: [...result.diagnostics, createDocumentRepositoryDiagnostic(writeResult.status)],
    }
  }

  function reconcileOperationHistoryAfterRepositoryWrite(input: {
    persistedGeneration: number
    persistedEntryCount: number
  } | null) {
    if (!operationHistoryStore || !input || input.persistedEntryCount === 0) {
      return
    }

    if (input.persistedGeneration === operationHistoryGeneration) {
      operationHistoryStore.clear()
      resetOperationHistoryPayloadForCurrentRepository()
      canPersistOperationHistory = true
      return
    }

    if (operationHistoryPayload.entries.length < input.persistedEntryCount) {
      return
    }

    operationHistoryPayload = {
      ...createEmptyOperationHistoryForCurrentRepository(),
      entries: operationHistoryPayload.entries.slice(input.persistedEntryCount),
    }

    try {
      operationHistoryStore.save(operationHistoryPayload)
      operationHistoryGeneration += 1
      canPersistOperationHistory = true
    } catch (error: unknown) {
      canPersistOperationHistory = false
      historyRestoreState = createRestoreFailure(
        'history-write-failed',
        error instanceof Error ? error.message : 'Operation history could not be written.',
        null,
        operationHistoryPayload.entries.length,
      )
    }
  }

  function enqueueAcceptedAuthoredDocumentPersistence() {
    if (!documentRepository || !canPersistAuthoredDocument) {
      return
    }

    repositoryPersistencePromise = repositoryPersistencePromise
      .catch(() => undefined)
      .then(async () => {
        if (!canPersistAuthoredDocument || !documentRepository) {
          return
        }

        const persistedHistory = operationHistoryStore
          ? {
              persistedGeneration: operationHistoryGeneration,
              persistedEntryCount: operationHistoryPayload.entries.length,
            }
          : null
        const writeResult = await documentRepository.mutate({
          documentId: currentDocumentId,
          document: await exportAuthoredDocumentForRepository(),
        })

        if (writeResult.ok) {
          markRepositorySnapshotFresh(writeResult.metadata)
          reconcileOperationHistoryAfterRepositoryWrite(persistedHistory)
          return
        }

        canPersistAuthoredDocument = false
        historyRestoreState = createRestoreFailure(
          writeResult.status.diagnostic.reasonCode,
          writeResult.status.diagnostic.message,
          null,
          historyRestoreState.entriesReplayed,
        )
      })
      .catch((error: unknown) => {
        canPersistAuthoredDocument = false
        historyRestoreState = createRestoreFailure(
          'repository-write-exception',
          error instanceof Error ? error.message : 'Authored document could not be written.',
          null,
          historyRestoreState.entriesReplayed,
        )
      })
  }

  return {
    currentDocumentId,
    sketchSolver,
    dispose() {
      unsubscribeDocumentRepository?.()
    },
    subscribeToDocumentChanges(listener) {
      documentChangeListeners.add(listener)
      if (latestDocumentChangeEvent) {
        queueMicrotask(() => {
          if (!documentChangeListeners.has(listener) || !latestDocumentChangeEvent) {
            return
          }

          listener({
            documentId: latestDocumentChangeEvent.documentId,
            metadata: {
              ...latestDocumentChangeEvent.metadata,
              heads: [...latestDocumentChangeEvent.metadata.heads],
            },
          })
        })
      }
      return () => {
        documentChangeListeners.delete(listener)
      }
    },
    async getHistoryRestoreState() {
      await restorePromise
      await repositoryChangePromise
      return historyRestoreState
    },
    resetOperationHistory,
    setViewportLodTier(tierId) {
      return adapter.setSnapshotLodTier?.(tierId) ?? false
    },
    async getCurrentDocumentSnapshot() {
      await restorePromise
      await repositoryChangePromise
      const response = await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId))
      return attachRepositoryProvenance(validateSnapshotResponse(response, currentDocumentId))
    },
    async createNewDocument() {
      await restorePromise
      await repositoryChangePromise
      return replaceCurrentAuthoredDocument(await getSeedAuthoredDocument())
    },
    async importDocument(input) {
      await restorePromise
      await repositoryChangePromise
      const normalized = normalizeImportedDocument(input.document)
      if (!normalized.ok) {
        return normalized
      }

      return replaceCurrentAuthoredDocument(normalized.document, input.assets ?? [])
    },
    async renameDocument(input) {
      await restorePromise
      await repositoryChangePromise
      const document = await exportAuthoredDocumentForRepository()
      if (document.name === input.name) {
        const snapshot = validateSnapshotResponse(
          await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
          currentDocumentId,
        )
        return { ok: true, revisionId: snapshot.document.revisionId, diagnostics: snapshot.document.diagnostics }
      }

      return replaceCurrentAuthoredDocument({
        ...document,
        name: input.name,
      })
    },
    async bindLocalFile(input) {
      await restorePromise
      await repositoryChangePromise
      if (!isLocalFileSyncDocumentRepository(documentRepository)) {
        return {
          ok: false,
          diagnostics: [
            createDocumentFileDiagnostic(
              'local-file-sync-unsupported-repository',
              'Local file sync is unavailable for the active document repository.',
            ),
          ],
        }
      }

      const result = await documentRepository.bindLocalFile({
        documentId: currentDocumentId,
        handle: input.handle,
        metadata: input.metadata,
      })
      if (!result.ok) {
        return {
          ok: false,
          diagnostics: [
            createDocumentFileDiagnostic('local-file-sync-bind-failed', result.message),
          ],
        }
      }

      const snapshot = validateSnapshotResponse(
        await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
        currentDocumentId,
      )
      return { ok: true, revisionId: snapshot.document.revisionId, diagnostics: [] }
    },
    async restoreLocalFileBinding() {
      await restorePromise
      await repositoryChangePromise
      if (!isLocalFileSyncDocumentRepository(documentRepository)) {
        return null
      }

      return documentRepository.restoreLocalFileBinding(currentDocumentId)
    },
    async getLocalFileSyncStatus() {
      if (!isLocalFileSyncDocumentRepository(documentRepository)) {
        return null
      }

      return documentRepository.getLocalFileSyncStatus(currentDocumentId)
    },
    subscribeToLocalFileSyncStatus(listener) {
      if (!isLocalFileSyncDocumentRepository(documentRepository)) {
        return () => undefined
      }

      return documentRepository.subscribeToLocalFileSyncStatus((status) => {
        if (status.documentId === currentDocumentId) {
          listener(status)
        }
      })
    },
    async exportCurrentDocument() {
      await restorePromise
      await repositoryChangePromise
      const document = await exportAuthoredDocumentForRepository()

      return {
        ok: true,
        format: 'cadara',
        filename: 'document.cadara',
        extension: 'cadara',
        mimeType: 'application/vnd.cadara+json',
        payload: createLocalAuthoredDocumentPayload(document),
        diagnostics: [],
      }
    },
    commitSketch(input) {
      return runModelingMutationBoundary({
        operation: 'Commit sketch',
        fallbackMessage: 'Commit sketch failed.',
        requestId: input.solverCorrelation?.requestId,
        context: [{ key: 'baseRevisionId', value: input.baseRevisionId }],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeCommitSketchInput(input, currentDocumentId)
          const response = await adapter.commitSketch(request)
          return finalizeMutationResult(
            response,
            mapCommitSketchResponse(response, currentDocumentId),
            input,
            () => createCommitSketchHistoryEntry(request, response.sketchId, {
              includeAuthoringOperations: !(documentRepository && documentRepositoryPersistence === 'background' && canPersistAuthoredDocument),
            }),
          )
        },
      })
    },
    async projectSketchExternalReferences(input) {
      await restorePromise
      await repositoryChangePromise
      return adapter.projectSketchExternalReferences(
        withContractVersion<ProjectSketchExternalReferencesRequest>({
          ...input,
          documentId: currentDocumentId,
        }),
      )
    },
    addDocumentVariable(input) {
      return runModelingMutationBoundary({
        operation: 'Add document variable',
        fallbackMessage: 'Add document variable failed.',
        context: [{ key: 'baseRevisionId', value: input.baseRevisionId }],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeAddDocumentVariableInput(input, currentDocumentId)
          const response = await adapter.addDocumentVariable(request)
          return finalizeMutationResult(
            response,
            mapDocumentVariableResponse(response, currentDocumentId),
            input,
            () => createAddDocumentVariableHistoryEntry(request, response.variableId),
          )
        },
      })
    },
    updateDocumentVariable(input) {
      return runModelingMutationBoundary({
        operation: 'Update document variable',
        fallbackMessage: 'Update document variable failed.',
        context: [
          { key: 'baseRevisionId', value: input.baseRevisionId },
          { key: 'variableId', value: input.variableId },
        ],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeUpdateDocumentVariableInput(input, currentDocumentId)
          const response = await adapter.updateDocumentVariable(request)
          return finalizeMutationResult(
            response,
            mapDocumentVariableResponse(response, currentDocumentId),
            input,
            () => createUpdateDocumentVariableHistoryEntry(request),
          )
        },
      })
    },
    createFeature(input) {
      return runModelingMutationBoundary({
        operation: 'Create feature',
        fallbackMessage: 'Create feature failed.',
        context: [{ key: 'baseRevisionId', value: input.baseRevisionId }],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeCreateFeatureInput(input, currentDocumentId)
          const response = await adapter.createFeature(request)
          return finalizeMutationResult(
            response,
            mapFeatureMutationResponse(response, currentDocumentId),
            input,
            () => createCreateFeatureHistoryEntry(request),
          )
        },
      })
    },
    updateFeature(input) {
      return runModelingMutationBoundary({
        operation: 'Update feature',
        fallbackMessage: 'Update feature failed.',
        context: [
          { key: 'baseRevisionId', value: input.baseRevisionId },
          { key: 'featureId', value: input.featureId },
        ],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeUpdateFeatureInput(input, currentDocumentId)
          const response = await adapter.updateFeature(request)
          return finalizeMutationResult(
            response,
            mapFeatureMutationResponse(response, currentDocumentId),
            input,
            () => createUpdateFeatureHistoryEntry(request),
          )
        },
      })
    },
    deleteFeature(input) {
      return runModelingMutationBoundary({
        operation: 'Delete feature',
        fallbackMessage: 'Delete feature failed.',
        context: [
          { key: 'baseRevisionId', value: input.baseRevisionId },
          { key: 'featureId', value: input.featureId },
        ],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeDeleteFeatureInput(input, currentDocumentId)
          const response = await adapter.deleteFeature(request)
          return finalizeMutationResult(
            response,
            mapDeleteFeatureResponse(response, currentDocumentId),
            input,
            () => createDeleteFeatureHistoryEntry(request),
          )
        },
      })
    },
    deleteTarget(input) {
      return runModelingMutationBoundary({
        operation: 'Delete target',
        fallbackMessage: 'Delete target failed.',
        context: [
          { key: 'baseRevisionId', value: input.baseRevisionId },
          { key: 'target', value: getPrimitiveRefKey(input.target) },
        ],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeDeleteTargetInput(input, currentDocumentId)
          const response = await adapter.deleteTarget(request)
          return finalizeMutationResult(
            response,
            mapDeleteTargetResponse(response, currentDocumentId),
            input,
            () => createDeleteTargetHistoryEntry(request),
          )
        },
      })
    },
    renameBody(input) {
      return runModelingMutationBoundary({
        operation: 'Rename body',
        fallbackMessage: 'Rename body failed.',
        context: [
          { key: 'baseRevisionId', value: input.baseRevisionId },
          { key: 'bodyId', value: input.bodyId },
        ],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeRenameBodyInput(input, currentDocumentId)
          const response = await adapter.renameBody(request)
          return finalizeMutationResult(
            response,
            mapRenameBodyResponse(response, currentDocumentId),
            input,
            () => createRenameBodyHistoryEntry(request),
          )
        },
      })
    },
    reorderFeature(input) {
      return runModelingMutationBoundary({
        operation: 'Reorder feature',
        fallbackMessage: 'Reorder feature failed.',
        context: [
          { key: 'baseRevisionId', value: input.baseRevisionId },
          { key: 'featureId', value: input.featureId },
        ],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeReorderFeatureInput(input, currentDocumentId)
          const response = await adapter.reorderFeature(request)
          return finalizeMutationResult(
            response,
            mapReorderFeatureResponse(response, currentDocumentId),
            input,
            () => createReorderFeatureHistoryEntry(request),
          )
        },
      })
    },
    reorderDocumentHistory(input) {
      return runModelingMutationBoundary({
        operation: 'Reorder document history',
        fallbackMessage: 'Reorder document history failed.',
        context: [
          { key: 'baseRevisionId', value: input.baseRevisionId },
          { key: 'item', value: input.item.kind === 'sketch' ? input.item.sketchId : input.item.featureId },
        ],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeReorderDocumentHistoryInput(input, currentDocumentId)
          const response = await adapter.reorderDocumentHistory(request)
          return finalizeMutationResult(
            response,
            mapReorderDocumentHistoryResponse(response, currentDocumentId),
            input,
            () => createReorderDocumentHistoryEntry(request),
          )
        },
      })
    },
    setFeatureCursor(input) {
      return runModelingMutationBoundary({
        operation: 'Set feature cursor',
        fallbackMessage: 'Set feature cursor failed.',
        context: [{ key: 'baseRevisionId', value: input.baseRevisionId }],
        action: async () => {
          await restorePromise
          await repositoryChangePromise
          const request = normalizeSetFeatureCursorInput(input, currentDocumentId)
          const response = await adapter.setFeatureCursor(request)
          return finalizeMutationResult(
            response,
            mapSetFeatureCursorResponse(response, currentDocumentId),
            input,
            input.persistHistory === false ? null : () => createSetFeatureCursorHistoryEntry(request),
          )
        },
      })
    },
    async evaluatePreview(input) {
      await restorePromise
      await repositoryChangePromise
      const response = await adapter.evaluatePreview(normalizePreviewInput(input, currentDocumentId))

      return mapPreviewResponse(response, currentDocumentId)
    },
    async exportDocument(input) {
      await restorePromise
      await repositoryChangePromise
      const request = normalizeExportDocumentInput(input, currentDocumentId)

      if (request.format !== 'cadara') {
        const capabilitiesOrDiagnostic = await adapter.getExportCapabilities(request.baseRevisionId)

        if ('code' in capabilitiesOrDiagnostic) {
          const failure: DocumentExportResult = {
            ok: false,
            format: request.format,
            diagnostics: [capabilitiesOrDiagnostic],
          }
          return mapExportDocumentResponse(failure)
        }

        return mapExportDocumentResponse(orchestrateGeometryExport(
          { format: request.format, options: request.options, target: request.target, targetLabel: request.targetLabel },
          capabilitiesOrDiagnostic,
          exportProviders,
        ))
      }

      const snapshot = await validateSnapshotResponse(
        await adapter.getDocumentSnapshot(buildDocumentRequest(currentDocumentId)),
        currentDocumentId,
      )

      if (request.baseRevisionId !== snapshot.document.revisionId) {
        return {
          ok: false,
          format: request.format,
          diagnostics: [
            createExportDiagnostic(
              'export-revision-conflict',
              `Export request revision ${request.baseRevisionId} does not match current revision ${snapshot.document.revisionId}.`,
              request.target,
            ),
          ],
        }
      }

      const cadaraOptions = cadaraExportOptionsSchema.parse(request.options)

      return mapExportDocumentResponse({
        ok: true,
        format: request.format,
        filename: createExportFilename(request.targetLabel, request.format),
        extension: 'cadara',
        mimeType: 'application/vnd.cadara+json',
        payload: stringifyCadaraDocument(snapshot.document, cadaraOptions.pretty),
        diagnostics: [],
      })
    },
    async resolveReference(target) {
      await restorePromise
      await repositoryChangePromise
      const response = await adapter.resolveReference(
        normalizeResolveReferenceInput(target, currentDocumentId),
      )

      const normalized = mapResolvedReferenceResponse(response, currentDocumentId)
      return {
        ...normalized,
        resolution: {
          ...normalized.resolution,
          label: getResolutionLabel(normalized.resolution),
        },
      }
    },
  }
}

/**
 * Optional runtime validators for typed modeling payloads.
 * The kernel boundary is statically authoritative; these helpers exist only for
 * callers that want defensive runtime checks around external adapter payloads.
 */
export const modelingRuntimeValidators = {
  revisionState: normalizeRevisionState,
  previewFreshness: normalizePreviewFreshness,
  rebuildResult: normalizeRebuildResult,
  featureTree: normalizeFeatureTree,
  objects: normalizeObjects,
  references: normalizeReferences,
  variables: normalizeDocumentVariables,
  renderables: normalizeRenderables,
  renderExport: (value: unknown) => renderExportSchema.parse(value),
  sketches: normalizeSketches,
  features: normalizeFeatures,
  documentFeatureCursor: normalizeDocumentFeatureCursor,
  bodies: normalizeBodies,
  constructions: normalizeConstructions,
  entities: normalizeEntities,
  resolution: normalizeResolution,
} as const
