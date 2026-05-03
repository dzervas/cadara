import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import type { EditorEvent, EditorHistoryAvailability } from '@/domain/editor/state-machine'
import type { SketchSessionState } from '@/domain/editor/sketch-session'
import { ok, type AppError, type ErrorReporter } from '@/contracts/errors'
import type {
  DocumentHistoryOrderEntry,
  WorkspaceSnapshot,
  DocumentVariableRecord,
} from '@/contracts/modeling/schema'
import {
  createDocumentHistoryOrder,
} from '@/domain/modeling/document-history'
import {
  documentHistoryOrdersEqual,
} from '@/app/workbench/history/workbench-history'
import { runReportedAction as runWorkbenchAction } from '@/lib/reported-action'
import { useWorkbenchDocumentOwner } from '@/hooks/use-workbench-document-owner'
import { useDurableHistory } from '@/hooks/use-durable-history'

type DocumentVariablePatch = Pick<DocumentVariableRecord, 'name' | 'valueText'>

interface WorkbenchHistoryControllerInput {
  deps?: Partial<WorkbenchHistoryDependencies>
  dispatch: (event: EditorEvent) => void
  errorReporter: ErrorReporter
  history: EditorHistoryAvailability
  setInvalidVariableValueMessages: Dispatch<SetStateAction<Record<string, string>>>
  showWorkbenchError: (message: string) => void
  sketchSession: SketchSessionState | null
  snapshot: WorkspaceSnapshot | null
}

interface WorkbenchHistoryDependencies {
  documentOwner: Pick<ReturnType<typeof useWorkbenchDocumentOwner>, 'reorderDocumentHistory' | 'updateDocumentVariable'>
  runWorkbenchAction: typeof runWorkbenchAction
}

const EMPTY_HISTORY_AVAILABILITY: EditorHistoryAvailability = {
  canUndo: false,
  canRedo: false,
}

export function useWorkbenchHistory({
  deps,
  dispatch,
  errorReporter,
  history: _history,
  setInvalidVariableValueMessages,
  showWorkbenchError,
  sketchSession,
  snapshot,
}: WorkbenchHistoryControllerInput) {
  const hookDocumentOwner = useWorkbenchDocumentOwner()
  const durableHistory = useDurableHistory()
  const documentOwner = deps?.documentOwner ?? hookDocumentOwner
  const runAction = deps?.runWorkbenchAction ?? runWorkbenchAction
  const [isUndoRedoRunning, setIsUndoRedoRunning] = useState(false)
  const [isDocumentHistoryReorderRunning, setIsDocumentHistoryReorderRunning] = useState(false)
  const [activeHistoryAvailability, setActiveHistoryAvailability] = useState<{
    contextKey: string
    availability: EditorHistoryAvailability
  } | null>(null)
  const snapshotRef = useRef(snapshot)
  const sketchSessionRef = useRef(sketchSession)

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    sketchSessionRef.current = sketchSession
  }, [sketchSession])

  const activeDocumentId = snapshot?.document.documentId ?? null
  const activeRevisionId = snapshot?.document.revisionId ?? null
  const activeHistoryContextKey = useMemo(() => {
    if (!activeDocumentId) {
      return null
    }

    if (!sketchSession) {
      return activeDocumentId
    }

    return `${activeDocumentId}:${durableHistory.getSketchDraftKey(sketchSession)}`
  }, [activeDocumentId, durableHistory, sketchSession])

  useEffect(() => {
    let cancelled = false

    if (!activeDocumentId || !activeHistoryContextKey || isUndoRedoRunning) {
      return
    }

    void durableHistory.getAvailability({
      documentId: activeDocumentId,
      sketchSession,
    }).then((availability) => {
      if (cancelled) {
        return
      }

      setActiveHistoryAvailability({
        contextKey: activeHistoryContextKey,
        availability,
      })
    }).catch(() => {
      if (!cancelled) {
        setActiveHistoryAvailability({
          contextKey: activeHistoryContextKey,
          availability: EMPTY_HISTORY_AVAILABILITY,
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    activeHistoryContextKey,
    activeDocumentId,
    activeRevisionId,
    durableHistory,
    isUndoRedoRunning,
    sketchSession,
  ])

  const toolbarHistoryAvailability = useMemo<EditorHistoryAvailability>(() => {
    if (!activeDocumentId || isUndoRedoRunning) {
      return EMPTY_HISTORY_AVAILABILITY
    }

    if (!activeHistoryContextKey || activeHistoryAvailability?.contextKey !== activeHistoryContextKey) {
      return EMPTY_HISTORY_AVAILABILITY
    }

    return activeHistoryAvailability.availability
  }, [
    activeDocumentId,
    activeHistoryAvailability,
    activeHistoryContextKey,
    isUndoRedoRunning,
  ])

  const setVariableFailure = useCallback((variableId: DocumentVariableRecord['variableId'], error: AppError) => {
    setInvalidVariableValueMessages((current) => ({
      ...current,
      [variableId]: error.message,
    }))
    showWorkbenchError(error.message)
  }, [setInvalidVariableValueMessages, showWorkbenchError])

  const requestUndo = useCallback(() => {
    const currentSnapshot = snapshotRef.current
    if (!currentSnapshot || isUndoRedoRunning) {
      return
    }

    setIsUndoRedoRunning(true)
    void durableHistory.undo({
      documentId: currentSnapshot.document.documentId,
      sketchSession: sketchSessionRef.current,
    }).then((result) => {
      if (!result) {
        return
      }

      if (result.context === 'document') {
        setActiveHistoryAvailability({
          contextKey: currentSnapshot.document.documentId,
          availability: result.availability,
        })
        dispatch({ type: 'document.replaced', snapshot: result.snapshot })
        return
      }

      setActiveHistoryAvailability({
        contextKey: `${currentSnapshot.document.documentId}:${durableHistory.getSketchDraftKey(result.session)}`,
        availability: result.availability,
      })
      dispatch({ type: 'sketch.draftHistoryRestored', session: result.session })
    }).catch((error: unknown) => {
      showWorkbenchError(error instanceof Error ? error.message : 'Undo failed.')
    }).finally(() => {
      setIsUndoRedoRunning(false)
    })
  }, [dispatch, durableHistory, isUndoRedoRunning, showWorkbenchError])

  const requestRedo = useCallback(() => {
    const currentSnapshot = snapshotRef.current
    if (!currentSnapshot || isUndoRedoRunning) {
      return
    }

    setIsUndoRedoRunning(true)
    void durableHistory.redo({
      documentId: currentSnapshot.document.documentId,
      sketchSession: sketchSessionRef.current,
    }).then((result) => {
      if (!result) {
        return
      }

      if (result.context === 'document') {
        setActiveHistoryAvailability({
          contextKey: currentSnapshot.document.documentId,
          availability: result.availability,
        })
        dispatch({ type: 'document.replaced', snapshot: result.snapshot })
        return
      }

      setActiveHistoryAvailability({
        contextKey: `${currentSnapshot.document.documentId}:${durableHistory.getSketchDraftKey(result.session)}`,
        availability: result.availability,
      })
      dispatch({ type: 'sketch.draftHistoryRestored', session: result.session })
    }).catch((error: unknown) => {
      showWorkbenchError(error instanceof Error ? error.message : 'Redo failed.')
    }).finally(() => {
      setIsUndoRedoRunning(false)
    })
  }, [dispatch, durableHistory, isUndoRedoRunning, showWorkbenchError])

  const handleVariableUpdate = useCallback((
    variable: DocumentVariableRecord,
    next: DocumentVariablePatch,
  ) => {
    if (!snapshot) {
      return
    }

    const operation = `Update ${variable.name || variable.variableId}`
    void runAction({
      operation,
      reporter: errorReporter,
      context: [
        { key: 'baseRevisionId', value: snapshot.document.revisionId },
        { key: 'variableId', value: variable.variableId },
      ],
      action: () => documentOwner.updateDocumentVariable(variable.variableId, next, {
        operation,
        fallbackMessage: `${operation} failed.`,
        context: [
          { key: 'baseRevisionId', value: snapshot.document.revisionId },
          { key: 'variableId', value: variable.variableId },
        ],
      }),
      mapSuccess: (output) => ok(output),
      onError: (error) => setVariableFailure(variable.variableId, error),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      setInvalidVariableValueMessages((current) => {
        const nextMessages = { ...current }
        delete nextMessages[variable.variableId]
        return nextMessages
      })
    })
  }, [
    documentOwner,
    errorReporter,
    runAction,
    setInvalidVariableValueMessages,
    setVariableFailure,
    snapshot,
  ])

  const handleDocumentHistoryReorder = useCallback((
    item: DocumentHistoryOrderEntry,
    beforeItem: DocumentHistoryOrderEntry | null,
  ) => {
    if (!snapshot || isDocumentHistoryReorderRunning) {
      return
    }

    const beforeOrder = createDocumentHistoryOrder(snapshot.presentation.documentHistory)
    setIsDocumentHistoryReorderRunning(true)
    void runAction({
      operation: 'Reorder document history',
      reporter: errorReporter,
      context: [{ key: 'baseRevisionId', value: snapshot.document.revisionId }],
      action: () => documentOwner.reorderDocumentHistory(item, beforeItem, {
        operation: 'Reorder document history',
        fallbackMessage: 'Reorder document history failed.',
        context: [{ key: 'baseRevisionId', value: snapshot.document.revisionId }],
      }),
      mapSuccess: (output) => ok(output),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      const afterOrder = createDocumentHistoryOrder(result.value.snapshot.presentation.documentHistory)
      if (!documentHistoryOrdersEqual(beforeOrder, afterOrder)) {
        return
      }
    }).finally(() => {
      setIsDocumentHistoryReorderRunning(false)
    })
  }, [
    documentOwner,
    errorReporter,
    isDocumentHistoryReorderRunning,
    runAction,
    showWorkbenchError,
    snapshot,
  ])

  return useMemo(() => ({
    handleDocumentHistoryReorder,
    handleVariableUpdate,
    isDocumentHistoryReorderRunning,
    isUndoRedoRunning,
    requestRedo,
    requestUndo,
    toolbarHistoryAvailability,
  }), [
    handleDocumentHistoryReorder,
    handleVariableUpdate,
    isDocumentHistoryReorderRunning,
    isUndoRedoRunning,
    requestRedo,
    requestUndo,
    toolbarHistoryAvailability,
  ])
}
