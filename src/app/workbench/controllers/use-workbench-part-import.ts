import { useCallback } from 'react'

import type { EditorEvent, EditorViewState } from '@/contracts/editor/state-machine'
import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import type { ImportProvider } from '@/contracts/import/provider'
import {
  applyImportPreparedActions,
  createImportCapabilities,
  createImportSession,
  prepareImportActions,
  resolveLocalFileImportSource,
} from '@/domain/import/orchestrator'
import { getAcceptedImportFileTypes, getImportProviderById, matchImportProviders } from '@/domain/import/provider-registry'
import type { ModelingService } from '@/domain/modeling/modeling-service'
import { showOpenImportFilePicker } from '@/lib/import-file-picker'

function promptForImportProvider(
  providers: readonly ImportProvider<unknown, unknown>[],
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
  activeImportSession: EditorViewState['activeImportSession']
  applyLoadedSnapshot: (snapshot: DocumentSnapshot) => void
  dispatch: (event: EditorEvent) => void
  modelingService: ModelingService
  showWorkbenchError: (message: string) => void
  showWorkbenchInfo: (message: string) => void
  snapshot: DocumentSnapshot | null
}

export function useWorkbenchPartImport({
  activeEditSession,
  activeImportSession,
  applyLoadedSnapshot,
  dispatch,
  modelingService,
  showWorkbenchError,
  showWorkbenchInfo,
  snapshot,
}: WorkbenchPartImportControllerInput) {
  const commitImportSession = useCallback(async () => {
    if (!activeImportSession || !snapshot) {
      return
    }

    const provider = getImportProviderById(activeImportSession.providerId)
    if (!provider) {
      showWorkbenchError('The selected import provider is no longer registered.')
      return
    }

    dispatch({ type: 'import.commitRequested' })

    try {
      const capabilities = createImportCapabilities(modelingService, snapshot)
      const actions = await prepareImportActions({
        provider,
        source: activeImportSession.resolvedSource,
        review: activeImportSession.review,
        selections: activeImportSession.selections,
        capabilities,
      })
      const result = await applyImportPreparedActions({
        modelingService,
        baseRevisionId: snapshot.revisionId,
        actions,
      })

      if (result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        dispatch({ type: 'import.failed', diagnostics: result.diagnostics })
        showWorkbenchError(result.diagnostics[0]?.message ?? 'Import failed.')
        return
      }

      const nextSnapshot = await modelingService.getCurrentDocumentSnapshot()
      applyLoadedSnapshot(nextSnapshot)
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
      showWorkbenchError(message)
    }
  }, [activeImportSession, applyLoadedSnapshot, dispatch, modelingService, showWorkbenchError, showWorkbenchInfo, snapshot])

  const requestPartImport = useCallback(async () => {
    if (activeEditSession || activeImportSession) {
      return
    }

    if (!snapshot) {
      showWorkbenchError('The current document is still loading.')
      return
    }

    const acceptedFileTypes = getAcceptedImportFileTypes()
    if (acceptedFileTypes.length === 0) {
      showWorkbenchError('No part importers are currently registered.')
      return
    }

    const pickerResult = await showOpenImportFilePicker({
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

    const resolvedSource = await resolveLocalFileImportSource(file)
    const matchedProviders = matchImportProviders(resolvedSource)

    if (matchedProviders.length === 0) {
      showWorkbenchError(`No importer is available for ${resolvedSource.name}.`)
      return
    }

    const provider = matchedProviders.length === 1
      ? matchedProviders[0]!
      : promptForImportProvider(matchedProviders)

    if (!provider) {
      return
    }

    try {
      const session = await createImportSession({
        provider,
        source: resolvedSource,
        capabilities: createImportCapabilities(modelingService, snapshot),
      })
      dispatch({ type: 'import.fileSelected', session })
    } catch (error: unknown) {
      showWorkbenchError(error instanceof Error ? error.message : 'Import review failed.')
    }
  }, [activeEditSession, activeImportSession, dispatch, modelingService, showWorkbenchError, snapshot])

  return {
    commitImportSession,
    requestPartImport,
  }
}
