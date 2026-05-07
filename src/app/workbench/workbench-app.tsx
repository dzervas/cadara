import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'

import type { ModelingKernelAdapter } from '@/contracts/modeling/adapter'
import type { PerformanceTelemetry } from '@/contracts/performance/telemetry'
import { noopPerformanceTelemetry } from '@/contracts/performance/telemetry'
import type { DocumentId } from '@/contracts/shared/ids'
import { createModelingService } from '@/domain/modeling/modeling-service'
import { createInstrumentedModelingService } from '@/domain/modeling/modeling-service/instrumented-service'
import { isLocalFileSyncDocumentRepository } from '@/domain/modeling/document-repository'
import { createInstrumentedDocumentRepository } from '@/domain/modeling/instrumented-document-repository'
import type { RuntimeExtensionRegistryComposition } from '@/domain/extensions/runtime-registry-composition'
import { OCC_KERNEL_DOCUMENT_ID } from '@/domain/modeling/opencascade-kernel-seed'
import { SketchConstraintSolverAdapter } from '@/domain/solver/sketch-constraint-solver-adapter'
import { createInstrumentedSketchSolverAdapter } from '@/domain/solver/instrumented-sketch-solver-adapter'
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
import { CadWorkbench } from '@/app/workbench/cad-workbench'
import { createDurableHistoryService } from '@/application/workbench/durable-history'
import { createLocalStorageOperationHistoryStore } from '@/infrastructure/persistence/local-storage-operation-history-store'
import { createLocalStorageWorkbenchTabsStore } from '@/infrastructure/persistence/local-storage-workbench-tabs-store'
import {
  createDocumentRepositoryUrlStorageKey,
  createLocalStorageDocumentRepositoryUrlStore,
  getDocumentRepositoryStorageNamespace,
} from '@/infrastructure/persistence/document-repository-url-store'
import { createWorkerBackedDocumentRepository } from '@/infrastructure/modeling/worker-backed-document-repository'
import type { DocumentSyncWorkerClient } from '@/infrastructure/workers/document-sync-worker-client'
import { DurableHistoryProvider } from '@/hooks/durable-history-provider'
import {
  openDocumentCopyAsTab,
  openLinkedDocumentAsTab,
  type WorkbenchDocumentActionResult,
} from '@/application/workbench/document-file-actions'

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

interface WorkbenchAppProps {
  actionBus: ToolActionBus
  createKernelAdapter: (documentId: DocumentId, performanceTelemetry?: PerformanceTelemetry) => ModelingKernelAdapter
  documentSyncWorkerClient: DocumentSyncWorkerClient | null
  performanceTelemetry?: PerformanceTelemetry
  runtimeExtensionRegistries: RuntimeExtensionRegistryComposition
}

export function WorkbenchApp({
  actionBus,
  createKernelAdapter,
  documentSyncWorkerClient,
  performanceTelemetry = noopPerformanceTelemetry,
  runtimeExtensionRegistries,
}: WorkbenchAppProps) {
  const tabsStorage = useMemo(() => (
    typeof window === 'undefined' ? null : createLocalStorageWorkbenchTabsStore(window.localStorage)
  ), [])
  const documentRepository = useMemo(() => {
    if (typeof window === 'undefined' || !documentSyncWorkerClient) {
      return null
    }

    return createInstrumentedDocumentRepository(createWorkerBackedDocumentRepository({
      client: documentSyncWorkerClient,
      urlStore: createLocalStorageDocumentRepositoryUrlStore(
        window.localStorage,
        createDocumentRepositoryUrlStorageKey(getDocumentRepositoryStorageNamespace(window.location.search)),
      ),
    }), performanceTelemetry)
  }, [documentSyncWorkerClient, performanceTelemetry])
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
      createInstrumentedModelingService(
        createModelingService(createKernelAdapter(tabsState.activeDocumentId, performanceTelemetry), {
          currentDocumentId: tabsState.activeDocumentId,
          sketchSolver: createInstrumentedSketchSolverAdapter(new SketchConstraintSolverAdapter({
            documentId: tabsState.activeDocumentId,
            revisionId: null,
          }), performanceTelemetry),
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
        performanceTelemetry,
      ),
    [createKernelAdapter, documentRepository, performanceTelemetry, runtimeExtensionRegistries.exportProviders, tabsState.activeDocumentId],
  )
  const durableHistory = useMemo(
    () => createDurableHistoryService({
      documentRepository,
      modelingService,
    }),
    [documentRepository, modelingService],
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

  const openDocumentCopy = useCallback(async (file: File): Promise<WorkbenchDocumentActionResult> => {
    return openDocumentCopyAsTab({
      file,
      repository: documentRepository,
      createDocumentId: generateDocumentId,
      openTab(tab) {
        tabsDispatch({ type: 'open', tab, activate: true })
      },
    })
  }, [documentRepository])

  const openLinkedDocument = useCallback(async (): Promise<WorkbenchDocumentActionResult> => {
    return openLinkedDocumentAsTab({
      repository: documentRepository,
      createDocumentId: generateDocumentId,
      openTab(tab) {
        tabsDispatch({ type: 'open', tab, activate: true })
      },
    })
  }, [documentRepository])

  return (
    <RuntimeExtensionRegistryProvider registries={runtimeExtensionRegistries}>
      <ModelingServiceProvider modelingService={modelingService}>
        <DurableHistoryProvider durableHistory={durableHistory}>
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
                onOpenDocumentCopy={openDocumentCopy}
                onOpenLinkedDocument={openLinkedDocument}
                performanceTelemetry={performanceTelemetry}
                onReorderDocumentTab={reorderDocumentTab}
                onSyncActiveDocumentTab={syncActiveDocumentTab}
              />
            </ToolActionProvider>
          </EditorProvider>
        </DurableHistoryProvider>
      </ModelingServiceProvider>
    </RuntimeExtensionRegistryProvider>
  )
}
