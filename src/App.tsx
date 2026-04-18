import { useMemo } from 'react'

import { CadWorkbench } from '@/app/cad-workbench'
import { createModelingService } from '@/domain/modeling/modeling-service'
import { createLocalStorageOperationHistoryStore } from '@/domain/modeling/modeling-history-persistence'
import {
  createIndexedDbAutomergeDocumentRepository,
  createLocalStorageDocumentRepositoryUrlStore,
} from '@/domain/modeling/automerge-indexeddb-document-repository'
import { OpenCascadeKernelAdapter } from '@/domain/modeling/opencascade-kernel-adapter'
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
} from '@/domain/modeling/opencascade-kernel-seed'
import { SketchConstraintSolverAdapter } from '@/domain/solver/sketch-constraint-solver-adapter'
import { EditorProvider } from '@/hooks/editor-provider'
import { ErrorReporterProvider } from '@/hooks/error-reporter-provider'
import { ModelingServiceProvider } from '@/hooks/modeling-service-provider'
import { ToolActionProvider } from '@/hooks/tool-action-provider'
import { createToolActionBus } from '@/domain/tools/tool-action-bus'
import { ReportedErrorBoundary } from '@/components/layout/reported-error-boundary'
import { BuildMetadataLabel } from '@/components/layout/build-metadata-label'

function App() {
  const actionBus = useMemo(() => createToolActionBus(), [])
  const kernelSketchSolver = useMemo(
    () => new SketchConstraintSolverAdapter({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
    }),
    [],
  )
  const editorSketchSolver = useMemo(
    () => new SketchConstraintSolverAdapter({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: null,
    }),
    [],
  )
  const kernelAdapter = useMemo(
    () =>
      new OpenCascadeKernelAdapter({
        solverAdapter: kernelSketchSolver,
        solverAdapterFactory: (revisionId) =>
          new SketchConstraintSolverAdapter({
            documentId: OCC_KERNEL_DOCUMENT_ID,
            revisionId,
          }),
      }),
    [kernelSketchSolver],
  )
  const modelingService = useMemo(
    () =>
      createModelingService(kernelAdapter, {
        currentDocumentId: OCC_KERNEL_DOCUMENT_ID,
        sketchSolver: editorSketchSolver,
        operationHistoryStore:
          typeof window === 'undefined'
            ? null
            : createLocalStorageOperationHistoryStore(window.localStorage),
        documentRepository:
          typeof window === 'undefined' || shouldDisableDevRepository()
            ? null
            : createIndexedDbAutomergeDocumentRepository({
                urlStore: createLocalStorageDocumentRepositoryUrlStore(window.localStorage),
                localPeerSync: getDevLocalPeerSyncOptions(),
                databaseName: getDevRepositoryDatabaseName(),
              }),
      }),
    [kernelAdapter, editorSketchSolver],
  )

  return (
    <ErrorReporterProvider>
      <ReportedErrorBoundary>
        <ModelingServiceProvider modelingService={modelingService}>
          <EditorProvider modelingService={modelingService}>
            <ToolActionProvider actionBus={actionBus}>
              <CadWorkbench />
            </ToolActionProvider>
          </EditorProvider>
        </ModelingServiceProvider>
      </ReportedErrorBoundary>
      <BuildMetadataLabel />
    </ErrorReporterProvider>
  )
}

function getDevLocalPeerSyncOptions() {
  if (typeof window === 'undefined' || !import.meta.env.DEV) {
    return false
  }

  const params = new URLSearchParams(window.location.search)
  if (params.get('cadLocalPeerSync') !== '1') {
    return false
  }

  return {
    channelName: params.get('cadLocalPeerSyncChannel') ?? 'cad-authored-documents-dev',
    peerWaitMs: 25,
  }
}

function getDevRepositoryDatabaseName() {
  if (typeof window === 'undefined' || !import.meta.env.DEV) {
    return undefined
  }

  return new URLSearchParams(window.location.search).get('cadRepositoryDbName') ?? undefined
}

function shouldDisableDevRepository() {
  if (typeof window === 'undefined' || !import.meta.env.DEV) {
    return false
  }

  return new URLSearchParams(window.location.search).get('cadDisableRepository') === '1'
}

export default App
