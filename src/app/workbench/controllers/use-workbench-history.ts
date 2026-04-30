import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import type { EditorEvent, EditorHistoryAvailability } from '@/contracts/editor/state-machine'
import { ok, type AppError, type ErrorReporter } from '@/contracts/errors'
import type {
  DocumentHistoryOrderEntry,
  DocumentSnapshot,
  DocumentVariableRecord,
} from '@/contracts/modeling/schema'
import {
  createDocumentHistoryOrder,
  getNextDocumentHistoryCursor,
  getPreviousDocumentHistoryCursor,
} from '@/domain/modeling/document-history'
import { getWorkbenchHistoryAvailability, documentHistoryOrdersEqual, getDocumentHistoryOrderRestoreMoves } from '@/app/workbench/history/workbench-history'
import { runWorkbenchAction } from '@/app/workbench/shared/workbench-action'
import { useWorkbenchDocumentOwner } from '@/hooks/use-workbench-document-owner'

type DocumentVariablePatch = Pick<DocumentVariableRecord, 'name' | 'valueText'>
type WorkbenchUndoEntry =
  | {
      kind: 'updateVariable'
      variableId: DocumentVariableRecord['variableId']
      before: DocumentVariablePatch
      after: DocumentVariablePatch
      label: string
    }
  | {
      kind: 'reorderDocumentHistory'
      before: DocumentHistoryOrderEntry[]
      after: DocumentHistoryOrderEntry[]
      label: string
    }

interface WorkbenchHistoryControllerInput {
  dispatch: (event: EditorEvent) => void
  errorReporter: ErrorReporter
  history: EditorHistoryAvailability
  setInvalidVariableValueMessages: Dispatch<SetStateAction<Record<string, string>>>
  showWorkbenchError: (message: string) => void
  sketchSession: unknown
  snapshot: DocumentSnapshot | null
}

export function useWorkbenchHistory({
  dispatch,
  errorReporter,
  history,
  setInvalidVariableValueMessages,
  showWorkbenchError,
  sketchSession,
  snapshot,
}: WorkbenchHistoryControllerInput) {
  const documentOwner = useWorkbenchDocumentOwner()
  const [undoStack, setUndoStack] = useState<WorkbenchUndoEntry[]>([])
  const [redoStack, setRedoStack] = useState<WorkbenchUndoEntry[]>([])
  const [isUndoRedoRunning, setIsUndoRedoRunning] = useState(false)
  const [isDocumentHistoryReorderRunning, setIsDocumentHistoryReorderRunning] = useState(false)
  const snapshotRef = useRef(snapshot)
  const undoStackRef = useRef(undoStack)
  const redoStackRef = useRef(redoStack)
  const sketchSessionRef = useRef(sketchSession)

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    undoStackRef.current = undoStack
  }, [undoStack])

  useEffect(() => {
    redoStackRef.current = redoStack
  }, [redoStack])

  useEffect(() => {
    sketchSessionRef.current = sketchSession
  }, [sketchSession])

  const toolbarHistoryAvailability: EditorHistoryAvailability = useMemo(
    () => sketchSession
      ? history
      : getWorkbenchHistoryAvailability({
          documentHistory: history,
          undoStackLength: undoStack.length,
          redoStackLength: redoStack.length,
          isUndoRedoRunning,
        }),
    [history, isUndoRedoRunning, redoStack.length, sketchSession, undoStack.length],
  )

  const setVariableFailure = (variableId: DocumentVariableRecord['variableId'], error: AppError) => {
    setInvalidVariableValueMessages((current) => ({
      ...current,
      [variableId]: error.message,
    }))
    showWorkbenchError(error.message)
  }

  const applyVariablePatch = async (
    variableId: DocumentVariableRecord['variableId'],
    next: DocumentVariablePatch,
    failureLabel: string,
  ) => {
    const currentSnapshot = snapshotRef.current
    if (!currentSnapshot) {
      return false
    }

    const result = await runWorkbenchAction({
      operation: failureLabel,
      reporter: errorReporter,
      context: [
        { key: 'baseRevisionId', value: currentSnapshot.document.revisionId },
        { key: 'variableId', value: variableId },
      ],
      action: () => documentOwner.updateDocumentVariable(variableId, next, {
        operation: failureLabel,
        fallbackMessage: `${failureLabel} failed.`,
        context: [
          { key: 'baseRevisionId', value: currentSnapshot.document.revisionId },
          { key: 'variableId', value: variableId },
        ],
      }),
      mapSuccess: (output) => ok(output),
      onError: (error) => setVariableFailure(variableId, error),
    })

    if (result.isOk()) {
      setInvalidVariableValueMessages((current) => {
        const nextMessages = { ...current }
        delete nextMessages[variableId]
        return nextMessages
      })
      return true
    }

    return false
  }

  const applyDocumentHistoryOrder = async (
    nextOrder: DocumentHistoryOrderEntry[],
    failureLabel: string,
  ) => {
    const currentSnapshot = snapshotRef.current
    if (!currentSnapshot) {
      return false
    }

    const currentOrder = createDocumentHistoryOrder(currentSnapshot.presentation.documentHistory)
    const moves = getDocumentHistoryOrderRestoreMoves(currentOrder, nextOrder)
    if (!moves) {
      return false
    }

    let accepted = true

    for (const move of moves) {
      const latestSnapshot = snapshotRef.current
      if (!latestSnapshot) {
        return false
      }

      const result = await runWorkbenchAction({
        operation: failureLabel,
        reporter: errorReporter,
        context: [{ key: 'baseRevisionId', value: latestSnapshot.document.revisionId }],
        action: () => documentOwner.reorderDocumentHistory(move.item, move.beforeItem, {
          operation: failureLabel,
          fallbackMessage: `${failureLabel} failed.`,
          context: [{ key: 'baseRevisionId', value: latestSnapshot.document.revisionId }],
        }),
        mapSuccess: (output) => ok(output),
        onError: (error) => showWorkbenchError(error.message),
      })

      if (result.isErr()) {
        accepted = false
        break
      }
    }

    const finalOrder = snapshotRef.current
      ? createDocumentHistoryOrder(snapshotRef.current.presentation.documentHistory)
      : currentOrder
    return accepted && documentHistoryOrdersEqual(nextOrder, finalOrder)
  }

  const applyUndoEntry = (entry: WorkbenchUndoEntry, direction: 'undo' | 'redo') => {
    switch (entry.kind) {
      case 'updateVariable':
        return applyVariablePatch(
          entry.variableId,
          direction === 'undo' ? entry.before : entry.after,
          direction === 'undo' ? `Undo ${entry.label}` : `Redo ${entry.label}`,
        )
      case 'reorderDocumentHistory':
        return applyDocumentHistoryOrder(
          direction === 'undo' ? entry.before : entry.after,
          direction === 'undo' ? `Undo ${entry.label}` : `Redo ${entry.label}`,
        )
    }
  }

  const requestUndo = () => {
    if (sketchSessionRef.current || isUndoRedoRunning) {
      if (sketchSessionRef.current) {
        dispatch({ type: 'history.undoRequested' })
      }
      return
    }

    const entry = undoStackRef.current.at(-1)
    const documentCursor = entry || !history.canUndo || !snapshotRef.current
      ? null
      : getPreviousDocumentHistoryCursor(snapshotRef.current)
    if (!entry && !documentCursor) {
      return
    }

    if (entry) {
      setIsUndoRedoRunning(true)
      void applyUndoEntry(entry, 'undo').then((accepted) => {
        if (accepted) {
          setUndoStack((current) => current.slice(0, -1))
          setRedoStack((current) => [...current, entry])
        }
      }).finally(() => {
        setIsUndoRedoRunning(false)
      })
      return
    }

    if (documentCursor) {
      dispatch({ type: 'document.historyCursorRequested', cursor: documentCursor })
    }
  }

  const requestRedo = () => {
    if (sketchSessionRef.current || isUndoRedoRunning) {
      if (sketchSessionRef.current) {
        dispatch({ type: 'history.redoRequested' })
      }
      return
    }

    const entry = redoStackRef.current.at(-1)
    const documentCursor = entry || !history.canRedo || !snapshotRef.current
      ? null
      : getNextDocumentHistoryCursor(snapshotRef.current)
    if (!entry && !documentCursor) {
      return
    }

    if (entry) {
      setIsUndoRedoRunning(true)
      void applyUndoEntry(entry, 'redo').then((accepted) => {
        if (accepted) {
          setRedoStack((current) => current.slice(0, -1))
          setUndoStack((current) => [...current, entry])
        }
      }).finally(() => {
        setIsUndoRedoRunning(false)
      })
      return
    }

    if (documentCursor) {
      dispatch({ type: 'document.historyCursorRequested', cursor: documentCursor })
    }
  }

  const handleVariableUpdate = (
    variable: DocumentVariableRecord,
    next: DocumentVariablePatch,
  ) => {
    if (!snapshot) {
      return
    }

    const operation = `Update ${variable.name || variable.variableId}`
    void runWorkbenchAction({
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
      setUndoStack((current) => [
        ...current,
        {
          kind: 'updateVariable',
          variableId: variable.variableId,
          before: {
            name: variable.name,
            valueText: variable.valueText,
          },
          after: next,
          label: variable.name || variable.variableId,
        },
      ])
      setRedoStack([])
    })
  }

  const handleDocumentHistoryReorder = (
    item: DocumentHistoryOrderEntry,
    beforeItem: DocumentHistoryOrderEntry | null,
  ) => {
    if (!snapshot || isDocumentHistoryReorderRunning) {
      return
    }

    const beforeOrder = createDocumentHistoryOrder(snapshot.presentation.documentHistory)
    setIsDocumentHistoryReorderRunning(true)
    void runWorkbenchAction({
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
        setUndoStack((current) => [
          ...current,
          {
            kind: 'reorderDocumentHistory',
            before: beforeOrder,
            after: afterOrder,
            label: 'document history reorder',
          },
        ])
        setRedoStack([])
      }
    }).finally(() => {
      setIsDocumentHistoryReorderRunning(false)
    })
  }

  const resetHistoryState = () => {
    setUndoStack([])
    setRedoStack([])
  }

  return {
    handleDocumentHistoryReorder,
    handleVariableUpdate,
    isDocumentHistoryReorderRunning,
    isUndoRedoRunning,
    requestRedo,
    requestUndo,
    resetHistoryState,
    toolbarHistoryAvailability,
  }
}
