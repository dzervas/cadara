import { useCallback } from 'react'

import type { EditorEvent, EditorViewState } from '@/domain/editor/state-machine'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import type { ImportProvider } from '@/contracts/import/provider'
import type { FeatureEditorFormSchema } from '@/core/feature-authoring/form-schema'
import {
  createAppError,
  errorContext,
  type ErrorReporter,
} from '@/contracts/errors'
import {
  createImportCapabilities,
  createImportSession,
  resolveLocalFileImportSource,
} from '@/domain/import/orchestrator'
import type { ImportProviderRegistry } from '@/domain/import/provider-registry'
import type { ModelingService } from '@/domain/modeling/modeling-service'
import { useWorkbenchDocumentOwner } from '@/hooks/use-workbench-document-owner'
import { useRuntimeExtensionRegistry } from '@/hooks/use-runtime-extension-registry'
import { handleWorkbenchFailure } from '@/app/workbench/failure-policy'
import { showOpenImportFilePicker } from '@/lib/import-file-picker'

function promptForImportProvider(
  providers: readonly ImportProvider<unknown, unknown, FeatureEditorFormSchema>[],
) {
  if (typeof window === 'undefined') {
    return providers[0] ?? null
  }

  const message = providers
    .map((provider, index) => `${index + 1}. ${provider.label}`)
    .join('\n')
  const response = window.prompt(`Multiple importers match this file.\n${message}\n\nChoose a provider number:`)
  const selectedIndex = Number.parseInt(response ?? '', 10)

  if (!Number.isFinite(selectedIndex) || selectedIndex < 1 || selectedIndex > providers.length) {
    return null
  }

  return providers[selectedIndex - 1] ?? null
}

interface WorkbenchPartImportControllerInput {
  activeEditSession: EditorViewState['activeEditSession']
  activeSketchPlaneEditSession?: EditorViewState['activeSketchPlaneEditSession']
  activeImportSession: EditorViewState['activeImportSession']
  deps?: Partial<WorkbenchPartImportDependencies>
  dispatch: (event: EditorEvent) => void
  errorReporter: ErrorReporter
  modelingService: ModelingService
  showWorkbenchError: (message: string) => void
  showWorkbenchInfo: (message: string) => void
  snapshot: WorkspaceSnapshot | null
}

interface WorkbenchPartImportDependencies {
  createCapabilities: typeof createImportCapabilities
  createSession: typeof createImportSession
  documentOwner: Pick<ReturnType<typeof useWorkbenchDocumentOwner>, 'commitPartImport'>
  importProviders: ImportProviderRegistry
  openImportFilePicker: typeof showOpenImportFilePicker
  promptForProvider: typeof promptForImportProvider
  resolveImportSource: typeof resolveLocalFileImportSource
}

export function useWorkbenchPartImport({
  activeEditSession,
  activeSketchPlaneEditSession = null,
  activeImportSession,
  deps,
  dispatch,
  errorReporter,
  modelingService,
  showWorkbenchError,
  showWorkbenchInfo,
  snapshot,
}: WorkbenchPartImportControllerInput) {
  const hookDocumentOwner = useWorkbenchDocumentOwner()
  const runtimeExtensionRegistry = useRuntimeExtensionRegistry()
  const documentOwner = deps?.documentOwner ?? hookDocumentOwner
  const importProviders = deps?.importProviders ?? runtimeExtensionRegistry.importProviders
  const openImportFilePicker = deps?.openImportFilePicker ?? showOpenImportFilePicker
  const resolveImportSource = deps?.resolveImportSource ?? resolveLocalFileImportSource
  const createCapabilities = deps?.createCapabilities ?? createImportCapabilities
  const createSession = deps?.createSession ?? createImportSession
  const promptForProvider = deps?.promptForProvider ?? promptForImportProvider

  const commitImportSession = useCallback(async () => {
    if (!activeImportSession || !snapshot) {
      return
    }

    dispatch({ type: 'import.commitRequested' })

    try {
      const result = await documentOwner.commitPartImport(activeImportSession)
      if (!result.ok) {
        dispatch({ type: 'import.failed', diagnostics: result.diagnostics })
        showWorkbenchError(result.diagnostics[0]?.message ?? 'Import failed.')
        return
      }

      dispatch({ type: 'import.committed' })
      if (result.createdEntityIds.sketchIds.length === 1) {
        dispatch({
          type: 'authoring.reopenRequested',
          target: {
            kind: 'sketch',
            sketchId: result.createdEntityIds.sketchIds[0]!,
          },
          toolId: 'sketch',
        })
      }
      showWorkbenchInfo(`Imported ${activeImportSession.resolvedSource.name}.`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Import failed.'
      dispatch({
        type: 'import.failed',
        diagnostics: [{
          code: 'import-commit-failed',
          severity: 'error',
          message,
          target: null,
          detail: null,
        }],
      })
      handleWorkbenchFailure({
        appError: createAppError({
          code: 'workbench/action-failed',
          message,
          context: errorContext('operation', 'commitPartImport'),
          cause: error,
        }),
        reporter: errorReporter,
        metadata: {
          source: 'workbench.import.commit',
          visibility: 'user',
          dedupeKey: `workbench.import.commit:${message}`,
        },
        reportability: 'reportable',
        userMessage: message,
        notify: showWorkbenchError,
      })
    }
  }, [activeImportSession, dispatch, documentOwner, errorReporter, showWorkbenchError, showWorkbenchInfo, snapshot])

  const requestPartImport = useCallback(async () => {
    if (activeEditSession || activeSketchPlaneEditSession || activeImportSession) {
      return
    }

    if (!snapshot) {
      showWorkbenchError('The current document is still loading.')
      return
    }

    const acceptedFileTypes = importProviders.getAcceptedFileTypes()
    if (acceptedFileTypes.length === 0) {
      showWorkbenchError('No part importers are currently registered.')
      return
    }

    const pickerResult = await openImportFilePicker({
      acceptedFileTypes,
    })

    if (!pickerResult.ok) {
      if (pickerResult.reason === 'failed') {
        showWorkbenchError('Import file selection failed.')
      }
      return
    }

    const file = pickerResult.files[0]
    if (!file) {
      showWorkbenchError('Import file selection failed.')
      return
    }

    const resolvedSource = await resolveImportSource(file)
    const matchedProviders = importProviders.matchProviders(resolvedSource)

    if (matchedProviders.length === 0) {
      showWorkbenchError(`No importer is available for ${resolvedSource.name}.`)
      return
    }

    const provider = matchedProviders.length === 1
      ? matchedProviders[0]!
      : promptForProvider(matchedProviders)

    if (!provider) {
      return
    }

    try {
      const session = await createSession({
        provider,
        source: resolvedSource,
        capabilities: createCapabilities(modelingService, snapshot),
      })
      dispatch({ type: 'import.fileSelected', session })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Import review failed.'
      handleWorkbenchFailure({
        appError: createAppError({
          code: 'workbench/action-failed',
          message,
          context: errorContext('operation', 'requestPartImport'),
          cause: error,
        }),
        reporter: errorReporter,
        metadata: {
          source: 'workbench.import.review',
          visibility: 'user',
          dedupeKey: `workbench.import.review:${message}`,
        },
        reportability: 'reportable',
        userMessage: message,
        notify: showWorkbenchError,
      })
    }
  }, [
    activeEditSession,
    activeSketchPlaneEditSession,
    activeImportSession,
    createCapabilities,
    createSession,
    dispatch,
    errorReporter,
    importProviders,
    modelingService,
    openImportFilePicker,
    promptForProvider,
    resolveImportSource,
    showWorkbenchError,
    snapshot,
  ])

  return {
    commitImportSession,
    requestPartImport,
  }
}
