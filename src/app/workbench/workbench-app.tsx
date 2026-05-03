import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'

import type { ModelingKernelAdapter } from '@/contracts/modeling/adapter'
import { parseAuthoredModelDocument } from '@/contracts/modeling/authored-document.runtime-schema'
import type { DocumentId } from '@/contracts/shared/ids'
import { createModelingService } from '@/domain/modeling/modeling-service'
import { isLocalFileSyncDocumentRepository } from '@/domain/modeling/document-repository'
import { createLocalFileBindingMetadata } from '@/domain/modeling/local-file-binding-store'
import type { RuntimeExtensionRegistryComposition } from '@/domain/extensions/runtime-registry-composition'
import { OCC_KERNEL_DOCUMENT_ID } from '@/domain/modeling/opencascade-kernel-seed'
import { SketchConstraintSolverAdapter } from '@/domain/solver/sketch-constraint-solver-adapter'
import {
  createInitialWorkbenchTabsState,
  reduceWorkbenchTabs,
  type WorkbenchTab,
  type WorkbenchTabsState,
} from '@/domain/workspace/workbench-tabs'
import { EditorProvider } from '@/hooks/editor-provider'
import { ModelingServiceProvider } from '@/hooks/modeling-service-provider'
import { RuntimeExtensionRegistryProvider } from '@/hooks/runtime-extension-registry-provider'
import { ToolActionProvider } from '@/hooks/tool-action-provider'
import type { ToolActionBus } from '@/core/tools/tool-action-bus'
import { CadWorkbench, type WorkbenchDocumentActionResult } from '@/app/workbench/cad-workbench'
import { createLocalStorageOperationHistoryStore } from '@/infrastructure/persistence/local-storage-operation-history-store'
import { createLocalStorageWorkbenchTabsStore } from '@/infrastructure/persistence/local-storage-workbench-tabs-store'
import {
  createDocumentRepositoryUrlStorageKey,
  createLocalStorageDocumentRepositoryUrlStore,
  getDocumentRepositoryStorageNamespace,
} from '@/infrastructure/persistence/document-repository-url-store'
import { createWorkerBackedDocumentRepository } from '@/infrastructure/modeling/worker-backed-document-repository'
import type { DocumentSyncWorkerClient } from '@/infrastructure/workers/document-sync-worker-client'
import {
  ensureLocalFileWritePermission,
  readCadaraDocumentFile,
  readLocalCadaraDocument,
  showOpenLocalDocumentPicker,
} from '@/lib/local-file-system-access'

const DEFAULT_WORKBENCH_DOCUMENT_NAME = 'Workspace'

function generateDocumentId(): DocumentId {
  const slug = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replaceAll('-', '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `doc_${slug}` as DocumentId
}

function createDefaultWorkbenchTab(documentId: DocumentId): WorkbenchTab {
  return {
    documentId,
    title: DEFAULT_WORKBENCH_DOCUMENT_NAME,
    storageKind: 'browser',
    storageDescriptor: null,
  }
}

function createWorkbenchOperationHistoryKey(documentId: DocumentId) {
  return `cad.modeling.operationHistory.${documentId}.v1`
}

function toDocumentActionError(
  source: string,
  message: string,
  error: unknown,
): WorkbenchDocumentActionResult {
  return {
    status: 'unexpected-error',
    source,
    message,
    error,
  }
}

interface WorkbenchAppProps {
  actionBus: ToolActionBus
  createKernelAdapter: (documentId: DocumentId) => ModelingKernelAdapter
  documentSyncWorkerClient: DocumentSyncWorkerClient | null
  runtimeExtensionRegistries: RuntimeExtensionRegistryComposition
}

export function WorkbenchApp({
  actionBus,
  createKernelAdapter,
  documentSyncWorkerClient,
  runtimeExtensionRegistries,
}: WorkbenchAppProps) {
  const tabsStorage = useMemo(() => (
    typeof window === 'undefined' ? null : createLocalStorageWorkbenchTabsStore(window.localStorage)
  ), [])
  const documentRepository = useMemo(() => {
    if (typeof window === 'undefined' || !documentSyncWorkerClient) {
      return null
    }

    return createWorkerBackedDocumentRepository({
      client: documentSyncWorkerClient,
      urlStore: createLocalStorageDocumentRepositoryUrlStore(
        window.localStorage,
        createDocumentRepositoryUrlStorageKey(getDocumentRepositoryStorageNamespace(window.location.search)),
      ),
    })
  }, [documentSyncWorkerClient])
  const [tabsState, tabsDispatch] = useReducer(
    reduceWorkbenchTabs,
    undefined,
    (): WorkbenchTabsState => {
      const fallback = createInitialWorkbenchTabsState(createDefaultWorkbenchTab(OCC_KERNEL_DOCUMENT_ID))
      if (!tabsStorage) {
        return fallback
      }

      const result = tabsStorage.load()
      return result.ok && result.state ? result.state : fallback
    },
  )
  const restoredBindingDocumentIdsRef = useRef(new Set<DocumentId>())
  const editorDependencies = useMemo(
    () => ({
      importProviders: runtimeExtensionRegistries.importProviders,
      sketchSpecialModes: runtimeExtensionRegistries.sketchSpecialModes,
    }),
    [runtimeExtensionRegistries.importProviders, runtimeExtensionRegistries.sketchSpecialModes],
  )
  const modelingService = useMemo(
    () =>
      createModelingService(createKernelAdapter(tabsState.activeDocumentId), {
        currentDocumentId: tabsState.activeDocumentId,
        sketchSolver: new SketchConstraintSolverAdapter({
          documentId: tabsState.activeDocumentId,
          revisionId: null,
        }),
        exportProviders: runtimeExtensionRegistries.exportProviders,
        operationHistoryStore:
          typeof window === 'undefined'
            ? null
            : createLocalStorageOperationHistoryStore(
                window.localStorage,
                createWorkbenchOperationHistoryKey(tabsState.activeDocumentId),
              ),
        documentRepositoryPersistence: 'background',
        documentRepository,
      }),
    [createKernelAdapter, documentRepository, runtimeExtensionRegistries.exportProviders, tabsState.activeDocumentId],
  )

  useEffect(() => {
    return () => {
      modelingService.dispose()
    }
  }, [modelingService])

  useEffect(() => {
    if (!tabsStorage) {
      return
    }
    tabsStorage.save(tabsState)
  }, [tabsState, tabsStorage])

  useEffect(() => {
    if (!isLocalFileSyncDocumentRepository(documentRepository)) {
      return
    }

    return documentRepository.subscribeToLocalFileSyncStatus((status) => {
      if (status.kind === 'idle') {
        tabsDispatch({
          type: 'updateStorage',
          documentId: status.documentId,
          storageKind: 'browser',
          storageDescriptor: null,
        })
        return
      }

      if (!status.metadata) {
        return
      }

      tabsDispatch({
        type: 'updateStorage',
        documentId: status.documentId,
        storageKind: 'filesystem',
        storageDescriptor: status.metadata.fileName,
      })
    })
  }, [documentRepository])

  useEffect(() => {
    if (!isLocalFileSyncDocumentRepository(documentRepository)) {
      return
    }

    for (const tab of tabsState.tabs) {
      if (restoredBindingDocumentIdsRef.current.has(tab.documentId)) {
        continue
      }
      restoredBindingDocumentIdsRef.current.add(tab.documentId)

      void documentRepository.restoreLocalFileBinding(tab.documentId).then((metadata) => {
        if (!metadata) {
          return
        }

        tabsDispatch({
          type: 'updateStorage',
          documentId: tab.documentId,
          storageKind: 'filesystem',
          storageDescriptor: metadata.fileName,
        })
      }).catch(() => {
        restoredBindingDocumentIdsRef.current.delete(tab.documentId)
      })
    }
  }, [documentRepository, tabsState.tabs])

  const createNewDocumentTab = useCallback(async () => {
    const documentId = generateDocumentId()
    tabsDispatch({
      type: 'open',
      tab: createDefaultWorkbenchTab(documentId),
      activate: true,
    })
    return documentId
  }, [])

  const activateDocumentTab = useCallback((documentId: DocumentId) => {
    tabsDispatch({ type: 'activate', documentId })
  }, [])

  const closeDocumentTab = useCallback((documentId: DocumentId) => {
    tabsDispatch({ type: 'close', documentId })
  }, [])

  const reorderDocumentTab = useCallback((documentId: DocumentId, toIndex: number) => {
    tabsDispatch({ type: 'reorder', documentId, toIndex })
  }, [])

  const syncActiveDocumentTab = useCallback((tab: WorkbenchTab) => {
    tabsDispatch({ type: 'syncActive', tab })
  }, [])

  const importDocumentFile = useCallback(async (file: File): Promise<WorkbenchDocumentActionResult> => {
    if (!documentRepository) {
      return {
        status: 'user-error',
        message: 'Document import requires the repository-backed workbench session.',
      }
    }

    let payload: unknown
    try {
      payload = await readCadaraDocumentFile(file)
    } catch (error: unknown) {
      return {
        status: 'user-error',
        message: error instanceof Error && error.message.includes('ZIP-backed .cadara packages are unsupported')
          ? 'Import failed. ZIP-backed .cadara packages are no longer supported; select a single JSON .cadara document.'
          : 'Import failed. Select a valid cadara JSON document.',
      }
    }

    const parsed = parseAuthoredModelDocument(structuredClone(payload))
    if (!parsed.ok) {
      return {
        status: 'user-error',
        message: parsed.diagnostic.message,
      }
    }

    const documentId = generateDocumentId()
    const result = await documentRepository.mutate({
      documentId,
      document: {
        ...parsed.document,
        documentId,
      },
    })
    if (!result.ok) {
      return {
        status: 'user-error',
        message: result.status.diagnostic.message,
      }
    }

    tabsDispatch({
      type: 'open',
      tab: {
        documentId,
        title: parsed.document.name,
        storageKind: 'browser',
        storageDescriptor: null,
      },
      activate: true,
    })
    return {
      status: 'success',
      documentId,
      message: `Imported ${file.name}.`,
    }
  }, [documentRepository])

  const openLocalFile = useCallback(async (): Promise<WorkbenchDocumentActionResult> => {
    if (!isLocalFileSyncDocumentRepository(documentRepository)) {
      return {
        status: 'user-error',
        message: 'Local file sync requires the repository-backed workbench session.',
      }
    }

    const pickerResult = await showOpenLocalDocumentPicker()
    if (!pickerResult.ok) {
      if (pickerResult.reason === 'cancelled') {
        return { status: 'cancelled' }
      }
      if (pickerResult.reason === 'unsupported') {
        return {
          status: 'user-error',
          message: 'Local file sync requires the File System Access API. In Brave, enable brave://flags/#file-system-access-api and relaunch, or use Chrome/Edge.',
        }
      }

      return toDocumentActionError(
        'workbench.file.openLocal',
        'Open local file failed.',
        pickerResult.error,
      )
    }

    if (!await ensureLocalFileWritePermission(pickerResult.handle)) {
      return {
        status: 'user-error',
        message: 'Local file write permission was denied.',
      }
    }

    let payload: unknown
    try {
      payload = await readLocalCadaraDocument(pickerResult.handle)
    } catch (error: unknown) {
      return {
        status: 'user-error',
        message: error instanceof Error && error.message.includes('ZIP-backed .cadara packages are unsupported')
          ? 'Open local file failed. ZIP-backed .cadara packages are no longer supported; select a single JSON .cadara document.'
          : 'Open local file failed. Select a valid cadara JSON document.',
      }
    }

    const parsed = parseAuthoredModelDocument(structuredClone(payload))
    if (!parsed.ok) {
      return {
        status: 'user-error',
        message: parsed.diagnostic.message,
      }
    }

    const documentId = generateDocumentId()
    const mutateResult = await documentRepository.mutate({
      documentId,
      document: {
        ...parsed.document,
        documentId,
      },
    })
    if (!mutateResult.ok) {
      return {
        status: 'user-error',
        message: mutateResult.status.diagnostic.message,
      }
    }

    const bindResult = await documentRepository.bindLocalFile({
      documentId,
      handle: pickerResult.handle,
      metadata: createLocalFileBindingMetadata(documentId, pickerResult.handle),
    })
    if (!bindResult.ok) {
      await documentRepository.reset(documentId)
      return {
        status: 'user-error',
        message: bindResult.message,
      }
    }

    tabsDispatch({
      type: 'open',
      tab: {
        documentId,
        title: parsed.document.name,
        storageKind: 'filesystem',
        storageDescriptor: pickerResult.handle.name,
      },
      activate: true,
    })
    return {
      status: 'success',
      documentId,
      message: `Opened ${pickerResult.handle.name}. Local file sync is active.`,
    }
  }, [documentRepository])

  return (
    <RuntimeExtensionRegistryProvider registries={runtimeExtensionRegistries}>
      <ModelingServiceProvider modelingService={modelingService}>
        <EditorProvider
          modelingService={modelingService}
          editorDependencies={editorDependencies}
        >
          <ToolActionProvider actionBus={actionBus}>
            <CadWorkbench
              tabsState={tabsState}
              onActivateDocumentTab={activateDocumentTab}
              onCloseDocumentTab={closeDocumentTab}
              onCreateNewDocument={createNewDocumentTab}
              onImportDocumentFile={importDocumentFile}
              onOpenLocalFile={openLocalFile}
              onReorderDocumentTab={reorderDocumentTab}
              onSyncActiveDocumentTab={syncActiveDocumentTab}
            />
          </ToolActionProvider>
        </EditorProvider>
      </ModelingServiceProvider>
    </RuntimeExtensionRegistryProvider>
  )
}
