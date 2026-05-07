import { normalizeCollaborativeAuthoredModelDocument } from '@/domain/modeling/collaborative-authored-document'
import type { AuthoredModelDocument, AuthoredModelDocumentDiagnostic } from '@/contracts/modeling/authored-document'
import {
  authoredModelDocumentsEqual,
  normalizeAuthoredDocumentId,
} from '@/contracts/modeling/authored-document-equality'
import { parseAuthoredModelDocument } from '@/contracts/modeling/authored-document.runtime-schema'
import {
  createDocumentSyncWorkerFailure,
  type DocumentSyncWorkerRequest,
  type DocumentSyncWorkerResponse,
  type DocumentSyncWriteStatus,
} from '@/domain/modeling/document-sync-worker-protocol'
import {
  isGeometryAssetDocumentRepository,
  type DocumentRepository,
} from '@/domain/modeling/document-repository'
import type { DocumentId } from '@/contracts/shared/ids'
import type { LocalFileBindingRecord, LocalFileBindingStore } from '@/domain/modeling/local-file-binding-store'
import type { DocumentRepositoryUrlStore } from '@/infrastructure/persistence/document-repository-url-store'
import {
  createLocalAuthoredDocumentPayload,
  readLocalCadaraDocument,
  writeTextToLocalFileHandle,
} from '@/lib/local-file-system-access'

export interface DocumentSyncWorkerRuntimeOptions {
  repository: DocumentRepository
  repositoryUrlStore?: DocumentRepositoryUrlStore | null
  bindingStore?: LocalFileBindingStore | null
}

export function createDocumentSyncWorkerMessageHandler(
  options: DocumentSyncWorkerRuntimeOptions,
  postMessage: (message: DocumentSyncWorkerResponse) => void,
) {
  const subscriptions = new Map<string, () => void>()
  const bindings = new Map<string, LocalFileBindingRecord>()
  const writeStatuses = new Map<string, DocumentSyncWriteStatus>()
  const pendingWrites = new Map<string, { document: AuthoredModelDocument; metadata: LocalFileBindingRecord['metadata'] }>()
  const activeWrites = new Set<string>()
  const writeSequences = new Map<string, number>()

  function nextWriteSequence(documentId: string) {
    const sequence = (writeSequences.get(documentId) ?? 0) + 1
    writeSequences.set(documentId, sequence)
    return sequence
  }

  function publishWriteStatus(status: DocumentSyncWriteStatus) {
    writeStatuses.set(status.documentId, status)
    postMessage({ kind: 'writeStatusChanged', status })
  }

  async function restoreBoundFileRecord(documentId: DocumentId, restoreOptions?: { throwOnFailure?: boolean }) {
    const restored = await options.bindingStore?.load(documentId)
    if (restored && !restored.ok) {
      if (restoreOptions?.throwOnFailure) {
        throw new Error(restored.reason === 'unsupported-storage' ? 'Persistent local file binding storage is unavailable.' : 'Local file binding could not be restored.')
      }
      return null
    }

    const record = restored?.value ?? null
    if (!record) {
      return null
    }

    bindings.set(documentId, record)
    const status: DocumentSyncWriteStatus = {
      kind: 'binding-restored',
      documentId,
      sequence: nextWriteSequence(documentId),
      metadata: record.metadata,
    }
    publishWriteStatus(status)
    return record
  }

  function createFailedLoadResult(documentId: DocumentId, diagnostic: AuthoredModelDocumentDiagnostic) {
    return {
      ok: false as const,
      status: {
        kind: 'failed' as const,
        documentId,
        diagnostic,
      },
    }
  }

  async function readBoundFileDocument(documentId: DocumentId, record: LocalFileBindingRecord) {
    let payload: unknown
    try {
      payload = await readLocalCadaraDocument(record.handle)
    } catch (error: unknown) {
      return createFailedLoadResult(documentId, {
        reasonCode: 'local-file-read-failed',
        message: error instanceof Error ? error.message : 'Linked local file could not be read.',
      })
    }

    const parsed = parseAuthoredModelDocument(structuredClone(payload))
    if (!parsed.ok) {
      return createFailedLoadResult(documentId, parsed.diagnostic)
    }

    return {
      ok: true as const,
      document: normalizeAuthoredDocumentId(parsed.document, documentId),
    }
  }

  function queueBoundFileWrite(
    documentId: string,
    document: AuthoredModelDocument,
  ) {
    const binding = bindings.get(documentId)
    if (!binding) {
      return
    }

    pendingWrites.set(documentId, {
      document,
      metadata: binding.metadata,
    })
    if (!activeWrites.has(documentId)) {
      void drainBoundFileWrites(documentId)
    }
  }

  async function drainBoundFileWrites(documentId: string) {
    activeWrites.add(documentId)
    try {
      while (pendingWrites.has(documentId)) {
        const pending = pendingWrites.get(documentId)!
        pendingWrites.delete(documentId)
        publishWriteStatus({
          kind: 'syncing',
          documentId: pending.metadata.documentId,
          sequence: nextWriteSequence(documentId),
          metadata: pending.metadata,
        })

        let result: Awaited<ReturnType<typeof writeTextToLocalFileHandle>>
        try {
          result = await writeTextToLocalFileHandle(
            bindings.get(documentId)!.handle,
            createLocalAuthoredDocumentPayload(pending.document),
          )
        } catch (error: unknown) {
          publishWriteStatus({
            kind: 'failed',
            documentId: pending.metadata.documentId,
            sequence: nextWriteSequence(documentId),
            metadata: pending.metadata,
            message: error instanceof Error ? error.message : 'Local file sync failed.',
          })
          continue
        }

        if (result.ok) {
          publishWriteStatus({
            kind: 'synced',
            documentId: pending.metadata.documentId,
            sequence: nextWriteSequence(documentId),
            metadata: pending.metadata,
          })
          continue
        }

        publishWriteStatus({
          kind: result.reason === 'permission-denied' ? 'permission-denied' : 'failed',
          documentId: pending.metadata.documentId,
          sequence: nextWriteSequence(documentId),
          metadata: pending.metadata,
          message: result.reason === 'permission-denied'
            ? 'Local file write permission was denied.'
            : result.error instanceof Error
              ? result.error.message
              : 'Local file sync failed.',
        })
      }
    } finally {
      activeWrites.delete(documentId)
    }
  }

  return async function handleDocumentSyncWorkerMessage(request: DocumentSyncWorkerRequest) {
    try {
      switch (request.kind) {
        case 'load': {
          if (request.storageKey) {
            options.repositoryUrlStore?.set(
              request.documentId,
              request.storageKey as Parameters<DocumentRepositoryUrlStore['set']>[1],
            )
          }
          const loadResult = await options.repository.load({
            documentId: request.documentId,
            seedDocument: request.seedDocument,
          })
          if (!loadResult.ok) {
            postMessage({
              kind: 'loaded',
              requestId: request.requestId,
              result: loadResult,
            })
            return
          }

          const boundFileRecord = await restoreBoundFileRecord(request.documentId)
          if (!boundFileRecord) {
            postMessage({
              kind: 'loaded',
              requestId: request.requestId,
              result: loadResult,
            })
            return
          }

          const boundFileDocument = await readBoundFileDocument(request.documentId, boundFileRecord)
          if (!boundFileDocument.ok) {
            postMessage({
              kind: 'loaded',
              requestId: request.requestId,
              result: boundFileDocument,
            })
            return
          }

          if (authoredModelDocumentsEqual(loadResult.document, boundFileDocument.document)) {
            postMessage({
              kind: 'loaded',
              requestId: request.requestId,
              result: loadResult,
            })
            return
          }

          postMessage({
            kind: 'loaded',
            requestId: request.requestId,
            result: await options.repository.mutate({
              documentId: request.documentId,
              document: boundFileDocument.document,
            }),
          })
          return
        }
        case 'reset': {
          options.repositoryUrlStore?.delete(request.documentId)
          postMessage({
            kind: 'reset',
            requestId: request.requestId,
            status: await options.repository.reset(request.documentId),
          })
          return
        }
        case 'mutate': {
          const result = await options.repository.mutate({
            documentId: request.documentId,
            document: request.document,
            assets: request.assets,
          })
          if (result.ok) {
            const normalized = normalizeCollaborativeAuthoredModelDocument(result.document)
            queueBoundFileWrite(request.documentId, normalized.document)
          }
          postMessage({
            kind: 'mutated',
            requestId: request.requestId,
            result,
          })
          return
        }
        case 'getGeometryAssetBytes': {
          postMessage({
            kind: 'geometryAssetBytes',
            requestId: request.requestId,
            bytes: isGeometryAssetDocumentRepository(options.repository)
              ? await options.repository.getGeometryAssetBytes(request.hash)
              : null,
          })
          return
        }
        case 'getGeometryAssetRecord': {
          postMessage({
            kind: 'geometryAssetRecord',
            requestId: request.requestId,
            bytes: isGeometryAssetDocumentRepository(options.repository)
              ? await options.repository.getGeometryAssetRecord(request.asset)
              : null,
          })
          return
        }
        case 'subscribe': {
          const unsubscribe = options.repository.subscribe(request.documentId, (event) => {
            const normalized = normalizeCollaborativeAuthoredModelDocument(event.document)
            queueBoundFileWrite(request.documentId, normalized.document)
            postMessage({
              kind: 'documentChanged',
              subscriptionId: request.subscriptionId,
              event,
            })
          })
          subscriptions.set(request.subscriptionId, unsubscribe)
          postMessage({
            kind: 'subscribed',
            requestId: request.requestId,
            subscriptionId: request.subscriptionId,
          })
          return
        }
        case 'unsubscribe': {
          subscriptions.get(request.subscriptionId)?.()
          subscriptions.delete(request.subscriptionId)
          postMessage({
            kind: 'unsubscribed',
            requestId: request.requestId,
            subscriptionId: request.subscriptionId,
          })
          return
        }
        case 'normalize': {
          const normalized = normalizeCollaborativeAuthoredModelDocument(request.document)
          postMessage({
            kind: 'normalized',
            requestId: request.requestId,
            result: {
              document: normalized.document,
              diagnostics: normalized.diagnostics,
              metadata: request.metadata,
            },
          })
          return
        }
        case 'restoreBinding': {
          const record = await restoreBoundFileRecord(request.documentId, { throwOnFailure: true })
          postMessage({
            kind: 'bindingRestored',
            requestId: request.requestId,
            record,
          })
          return
        }
        case 'bindFileHandle': {
          const record = {
            metadata: request.metadata,
            handle: request.handle,
          }
          bindings.set(request.documentId, record)
          const saved = await options.bindingStore?.save(record)
          const persistentBindingUnavailable = saved && !saved.ok && saved.reason === 'unsupported-storage'
          if (saved && !saved.ok && saved.reason !== 'unsupported-storage') {
            throw new Error('Local file binding could not be persisted.')
          }

          postMessage({
            kind: 'fileHandleBound',
            requestId: request.requestId,
            metadata: request.metadata,
          })
          if (persistentBindingUnavailable) {
            publishWriteStatus({
              kind: 'persistent-binding-unavailable',
              documentId: request.documentId,
              sequence: nextWriteSequence(request.documentId),
              metadata: request.metadata,
              message: 'Local file sync is active, but this browser cannot remember the file after refresh.',
            })
          }
          publishWriteStatus({
            kind: 'synced',
            documentId: request.documentId,
            sequence: nextWriteSequence(request.documentId),
            metadata: request.metadata,
          })
          return
        }
        case 'getWriteStatus': {
          postMessage({
            kind: 'writeStatus',
            requestId: request.requestId,
            status: writeStatuses.get(request.documentId) ?? {
              kind: 'idle',
              documentId: request.documentId,
              sequence: 0,
            },
          })
          return
        }
        case 'getDurableHistoryAvailability': {
          postMessage({
            kind: 'durableHistoryAvailability',
            requestId: request.requestId,
            availability: await options.repository.getDurableHistoryAvailability(request.documentId),
          })
          return
        }
        case 'undoDurableHistory': {
          postMessage({
            kind: 'durableHistoryMutated',
            requestId: request.requestId,
            result: await options.repository.undoDurableHistory(request.documentId),
          })
          return
        }
        case 'redoDurableHistory': {
          postMessage({
            kind: 'durableHistoryMutated',
            requestId: request.requestId,
            result: await options.repository.redoDurableHistory(request.documentId),
          })
          return
        }
        case 'getSketchDraftHistory': {
          const result = await options.repository.getSketchDraftHistory(request.documentId, request.draftKey)
          postMessage({
            kind: 'sketchDraftHistory',
            requestId: request.requestId,
            session: result.session,
            availability: result.availability,
          })
          return
        }
        case 'saveSketchDraftHistory': {
          postMessage({
            kind: 'sketchDraftHistorySaved',
            requestId: request.requestId,
            availability: await options.repository.saveSketchDraftHistory(
              request.documentId,
              request.draftKey,
              request.session,
            ),
          })
          return
        }
        case 'undoSketchDraftHistory': {
          const result = await options.repository.undoSketchDraftHistory(request.documentId, request.draftKey)
          postMessage({
            kind: 'sketchDraftHistory',
            requestId: request.requestId,
            session: result.session,
            availability: result.availability,
          })
          return
        }
        case 'redoSketchDraftHistory': {
          const result = await options.repository.redoSketchDraftHistory(request.documentId, request.draftKey)
          postMessage({
            kind: 'sketchDraftHistory',
            requestId: request.requestId,
            session: result.session,
            availability: result.availability,
          })
          return
        }
        case 'clearSketchDraftHistory': {
          await options.repository.clearSketchDraftHistory(request.documentId, request.draftKey)
          postMessage({
            kind: 'sketchDraftHistoryCleared',
            requestId: request.requestId,
          })
          return
        }
      }
    } catch (error: unknown) {
      postMessage(createDocumentSyncWorkerFailure(request.requestId, error))
    }
  }
}
