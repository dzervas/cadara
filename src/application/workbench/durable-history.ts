import type {
  DurableHistoryAvailability,
  PersistedSketchDraftSession,
} from '@/contracts/modeling/durable-history'
import type { DocumentId } from '@/contracts/shared/ids'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import type { SketchSessionState } from '@/domain/editor/sketch-session'
import { persistSketchDraftSession, restorePersistedSketchDraftSession } from '@/domain/editor/sketch-session/persistence'
import type { ModelingService } from '@/domain/modeling/modeling-service'
import type {
  DocumentRepository,
  DocumentRepositoryMetadata,
} from '@/domain/modeling/document-repository'

export type DurableHistoryContext = 'document' | 'sketch'

export type DurableHistoryActionResult =
  | {
      context: 'document'
      snapshot: WorkspaceSnapshot
      availability: DurableHistoryAvailability
    }
  | {
      context: 'sketch'
      session: SketchSessionState
      availability: DurableHistoryAvailability
    }

export interface DurableHistoryService {
  getAvailability(input: {
    documentId: DocumentId
    sketchSession: SketchSessionState | null
  }): Promise<DurableHistoryAvailability>
  undo(input: {
    documentId: DocumentId
    sketchSession: SketchSessionState | null
  }): Promise<DurableHistoryActionResult | null>
  redo(input: {
    documentId: DocumentId
    sketchSession: SketchSessionState | null
  }): Promise<DurableHistoryActionResult | null>
  restoreSketchDraft(input: {
    documentId: DocumentId
    session: SketchSessionState
  }): Promise<SketchSessionState | null>
  syncSketchDraft(input: {
    documentId: DocumentId
    session: SketchSessionState
  }): Promise<DurableHistoryAvailability>
  clearSketchDraft(input: {
    documentId: DocumentId
    draftKey: string
  }): Promise<void>
  getSketchDraftKey(session: SketchSessionState): string
}

export function createDurableHistoryService(input: {
  documentRepository: DocumentRepository | null
  modelingService: ModelingService
}): DurableHistoryService {
  const { documentRepository, modelingService } = input
  const draftAvailabilityCache = new Map<string, {
    sessionHash: string
    availability: DurableHistoryAvailability
  }>()

  function getSketchDraftKey(session: SketchSessionState) {
    if (session.sketchId) {
      return `sketch:${session.sketchId}`
    }

    const support = session.plane.support
    switch (support.kind) {
      case 'construction':
        return `new-sketch:construction:${support.constructionId}`
      case 'face':
        return `new-sketch:face:${support.faceId}`
    }
  }

  function createDraftCacheKey(documentId: DocumentId, draftKey: string) {
    return `${documentId}:${draftKey}`
  }

  function getPersistedSessionHash(session: PersistedSketchDraftSession) {
    return JSON.stringify(session)
  }

  function getSketchSessionHash(session: SketchSessionState) {
    return getPersistedSessionHash(persistSketchDraftSession(session))
  }

  function setDraftAvailability(
    documentId: DocumentId,
    draftKey: string,
    sessionHash: string,
    availability: DurableHistoryAvailability,
  ) {
    draftAvailabilityCache.set(createDraftCacheKey(documentId, draftKey), {
      sessionHash,
      availability,
    })
  }

  function clearDraftAvailability(documentId: DocumentId, draftKey: string) {
    draftAvailabilityCache.delete(createDraftCacheKey(documentId, draftKey))
  }

  function sameRepositoryHeads(left: readonly string[], right: readonly string[]) {
    return left.length === right.length
      && [...left].sort().every((head, index) => head === [...right].sort()[index])
  }

  function repositoryChangeMatches(
    event: Parameters<ModelingService['subscribeToDocumentChanges']>[0] extends (event: infer TEvent) => void ? TEvent : never,
    metadata: Pick<DocumentRepositoryMetadata, 'documentId' | 'heads' | 'source'>,
  ) {
    return event.documentId === metadata.documentId
      && event.metadata.source === metadata.source
      && sameRepositoryHeads(event.metadata.heads, metadata.heads)
  }

  function createRepositoryChangeWaiter(documentId: DocumentId) {
    type DocumentChangeEvent = Parameters<ModelingService['subscribeToDocumentChanges']>[0] extends (event: infer TEvent) => void
      ? TEvent
      : never

    const seenEvents: DocumentChangeEvent[] = []
    const pendingWaits = new Set<{
      metadata: Pick<DocumentRepositoryMetadata, 'documentId' | 'heads' | 'source'>
      resolve: () => void
      reject: (error: Error) => void
      timeoutId: ReturnType<typeof setTimeout>
    }>()

    const unsubscribe = modelingService.subscribeToDocumentChanges((event) => {
      if (event.documentId !== documentId) {
        return
      }

      seenEvents.push(event)
      for (const pending of pendingWaits) {
        if (!repositoryChangeMatches(event, pending.metadata)) {
          continue
        }

        clearTimeout(pending.timeoutId)
        pendingWaits.delete(pending)
        pending.resolve()
      }
    })

    return {
      waitFor(metadata: Pick<DocumentRepositoryMetadata, 'documentId' | 'heads' | 'source'>) {
        if (seenEvents.some((event) => repositoryChangeMatches(event, metadata))) {
          return Promise.resolve()
        }

        return new Promise<void>((resolve, reject) => {
          const pending = {
            metadata,
            resolve,
            reject,
            timeoutId: setTimeout(() => {
              pendingWaits.delete(pending)
              reject(new Error(`Timed out waiting for repository ${metadata.source} synchronization.`))
            }, 2_000),
          }
          pendingWaits.add(pending)
        })
      },
      dispose() {
        unsubscribe()
        for (const pending of pendingWaits) {
          clearTimeout(pending.timeoutId)
        }
        pendingWaits.clear()
      },
    }
  }

  async function getAvailability({
    documentId,
    sketchSession,
  }: {
    documentId: DocumentId
    sketchSession: SketchSessionState | null
  }) {
    if (!documentRepository) {
      return { canUndo: false, canRedo: false }
    }

    if (sketchSession) {
      const draftKey = getSketchDraftKey(sketchSession)
      const sessionHash = getSketchSessionHash(sketchSession)
      const cached = draftAvailabilityCache.get(createDraftCacheKey(documentId, draftKey))
      if (cached) {
        if (cached.sessionHash === sessionHash) {
          return cached.availability
        }

        return {
          canUndo: true,
          canRedo: false,
        }
      }

      const result = await documentRepository.getSketchDraftHistory(
        documentId,
        draftKey,
      )
      if (result.session) {
        setDraftAvailability(
          documentId,
          draftKey,
          getPersistedSessionHash(result.session),
          result.availability,
        )
      }
      return result.availability
    }

    await modelingService.waitForPersistence()
    return documentRepository.getDurableHistoryAvailability(documentId)
  }

  async function undo({
    documentId,
    sketchSession,
  }: {
    documentId: DocumentId
    sketchSession: SketchSessionState | null
  }): Promise<DurableHistoryActionResult | null> {
    if (!documentRepository) {
      return null
    }

    if (sketchSession) {
      const draftKey = getSketchDraftKey(sketchSession)
      const result = await documentRepository.undoSketchDraftHistory(
        documentId,
        draftKey,
      )
      if (result.session) {
        setDraftAvailability(
          documentId,
          draftKey,
          getPersistedSessionHash(result.session),
          result.availability,
        )
      } else {
        clearDraftAvailability(documentId, draftKey)
      }
      return result.session
        ? {
            context: 'sketch',
            session: restorePersistedSketchDraftSession(result.session),
            availability: result.availability,
          }
        : null
    }

    await modelingService.waitForPersistence()
    const repositoryChangeWaiter = createRepositoryChangeWaiter(documentId)
    try {
      const result = await documentRepository.undoDurableHistory(documentId)
      if (!result?.ok) {
        return null
      }

      await repositoryChangeWaiter.waitFor(result.metadata)

      return {
        context: 'document',
        snapshot: await modelingService.getCurrentDocumentSnapshot(),
        availability: await documentRepository.getDurableHistoryAvailability(documentId),
      }
    } finally {
      repositoryChangeWaiter.dispose()
    }
  }

  async function redo({
    documentId,
    sketchSession,
  }: {
    documentId: DocumentId
    sketchSession: SketchSessionState | null
  }): Promise<DurableHistoryActionResult | null> {
    if (!documentRepository) {
      return null
    }

    if (sketchSession) {
      const draftKey = getSketchDraftKey(sketchSession)
      const result = await documentRepository.redoSketchDraftHistory(
        documentId,
        draftKey,
      )
      if (result.session) {
        setDraftAvailability(
          documentId,
          draftKey,
          getPersistedSessionHash(result.session),
          result.availability,
        )
      } else {
        clearDraftAvailability(documentId, draftKey)
      }
      return result.session
        ? {
            context: 'sketch',
            session: restorePersistedSketchDraftSession(result.session),
            availability: result.availability,
          }
        : null
    }

    await modelingService.waitForPersistence()
    const repositoryChangeWaiter = createRepositoryChangeWaiter(documentId)
    try {
      const result = await documentRepository.redoDurableHistory(documentId)
      if (!result?.ok) {
        return null
      }

      await repositoryChangeWaiter.waitFor(result.metadata)

      return {
        context: 'document',
        snapshot: await modelingService.getCurrentDocumentSnapshot(),
        availability: await documentRepository.getDurableHistoryAvailability(documentId),
      }
    } finally {
      repositoryChangeWaiter.dispose()
    }
  }

  async function restoreSketchDraft({
    documentId,
    session,
  }: {
    documentId: DocumentId
    session: SketchSessionState
  }) {
    if (!documentRepository) {
      return null
    }

    const draftKey = getSketchDraftKey(session)
    const result = await documentRepository.getSketchDraftHistory(
      documentId,
      draftKey,
    )
    if (result.session) {
      setDraftAvailability(
        documentId,
        draftKey,
        getPersistedSessionHash(result.session),
        result.availability,
      )
    } else {
      clearDraftAvailability(documentId, draftKey)
    }
    return result.session ? restorePersistedSketchDraftSession(result.session) : null
  }

  async function syncSketchDraft({
    documentId,
    session,
  }: {
    documentId: DocumentId
    session: SketchSessionState
  }) {
    if (!documentRepository) {
      return { canUndo: false, canRedo: false }
    }

    const draftKey = getSketchDraftKey(session)
    const persistedSession = persistSketchDraftSession(session)
    const sessionHash = getPersistedSessionHash(persistedSession)
    const cached = draftAvailabilityCache.get(createDraftCacheKey(documentId, draftKey))
    if (cached && cached.sessionHash !== sessionHash) {
      setDraftAvailability(documentId, draftKey, sessionHash, {
        canUndo: true,
        canRedo: false,
      })
    }

    const availability = await documentRepository.saveSketchDraftHistory(
      documentId,
      draftKey,
      persistedSession,
    )
    setDraftAvailability(documentId, draftKey, sessionHash, availability)
    return availability
  }

  async function clearSketchDraft({
    documentId,
    draftKey,
  }: {
    documentId: DocumentId
    draftKey: string
  }) {
    clearDraftAvailability(documentId, draftKey)
    await documentRepository?.clearSketchDraftHistory(documentId, draftKey)
  }

  return {
    getAvailability,
    undo,
    redo,
    restoreSketchDraft,
    syncSketchDraft,
    clearSketchDraft,
    getSketchDraftKey,
  }
}
