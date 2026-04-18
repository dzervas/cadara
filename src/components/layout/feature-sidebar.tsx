import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Paper, Text, Tooltip } from '@mantine/core'

import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import { WorkbenchContextMenu, type WorkbenchContextMenuEntry } from '@/components/layout/workbench-context-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { PrimitiveRef } from '@/domain/editor/schema'
import {
  getPrimitiveRefKey,
  getPrimitiveRefLabel,
  selectionFilterAllowsTarget,
} from '@/domain/editor/schema'
import type { DocumentSnapshot, DocumentVariableRecord, ModelingDiagnostic } from '@/contracts/modeling/schema'
import { evaluateDocumentVariableExpressions } from '@/domain/modeling/document-variable-expressions'
import { useEditorState } from '@/hooks/use-editor-state'

interface FeatureSidebarProps {
  hiddenTargetKeys: Record<string, boolean>
  invalidVariableValueIds?: Record<string, boolean>
  invalidVariableValueMessages?: Record<string, string>
  objectLabelOverrides: Record<string, string>
  onAddVariable: () => void
  onInspectDiagnostic: (diagnostic: ModelingDiagnostic) => void
  onObjectDelete: (target: PrimitiveRef, label: string) => void
  onObjectExport: (target: PrimitiveRef, label: string) => void
  onRenameTarget: (target: PrimitiveRef, label: string) => void
  onReopenTarget: (target: PrimitiveRef) => void
  onToggleTargetVisibility: (target: PrimitiveRef) => void
  onUpdateVariable: (variable: DocumentVariableRecord, next: Pick<DocumentVariableRecord, 'name' | 'valueText'>) => void
  snapshot: DocumentSnapshot | null
  onSelectTarget: (target: PrimitiveRef) => void
  visibleSelection: PrimitiveRef[]
}

function formatDocumentDiagnosticDetail(diagnostic: ModelingDiagnostic) {
  const detail = diagnostic.detail

  if (!detail) {
    return null
  }

  switch (detail.kind) {
    case 'invalidReference':
      return `Broken ref ${getPrimitiveRefLabel(detail.reference.target)} from ${
        detail.reference.sourceTarget ? getPrimitiveRefLabel(detail.reference.sourceTarget) : 'document state'
      }`
    case 'revisionConflict':
      return `Expected ${detail.expectedRevisionId}, current ${detail.actualRevisionId}`
    case 'stalePreview':
      return `Preview ${detail.previewId} requested ${detail.requestedRevisionId}, current ${detail.currentRevisionId}`
    case 'rebuildFailure':
      return `Affected features: ${detail.affectedFeatureIds.join(', ') || 'none'} | Targets: ${
        detail.affectedTargets.map((target) => getPrimitiveRefLabel(target)).join(', ') || 'none'
      }`
  }
}

type VariableResultPresentation =
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: '???'; message: string }

function formatVariableResult(value: number) {
  return Number.isInteger(value) ? String(value) : Number.parseFloat(value.toPrecision(12)).toString()
}

function getVariableResultPresentations(
  variables: readonly DocumentVariableRecord[],
  invalidVariableValueIds: Record<string, boolean>,
  invalidVariableValueMessages: Record<string, string>,
) {
  const evaluation = evaluateDocumentVariableExpressions(variables)
  const diagnosticsByVariableId = new Map<DocumentVariableRecord['variableId'], string>()
  const presentations = new Map<DocumentVariableRecord['variableId'], VariableResultPresentation>()

  if (!evaluation.ok) {
    for (const diagnostic of evaluation.diagnostics) {
      if (!diagnosticsByVariableId.has(diagnostic.variableId)) {
        diagnosticsByVariableId.set(diagnostic.variableId, diagnostic.message)
      }
    }
  }

  for (const variable of variables) {
    const runtimeError =
      invalidVariableValueMessages[variable.variableId]
      ?? (invalidVariableValueIds[variable.variableId] ? 'Variable expression failed to evaluate.' : null)
    const evaluationError =
      runtimeError
      ?? diagnosticsByVariableId.get(variable.variableId)
      ?? (!evaluation.ok ? 'Variable expression evaluation is blocked by another variable error.' : null)

    if (evaluationError) {
      presentations.set(variable.variableId, {
        kind: 'error',
        text: '???',
        message: evaluationError,
      })
      continue
    }

    if (!evaluation.ok) {
      presentations.set(variable.variableId, {
        kind: 'error',
        text: '???',
        message: 'Variable expression result is unavailable.',
      })
      continue
    }

    const evaluatedValue = evaluation.valuesById.get(variable.variableId)
    if (evaluatedValue === undefined) {
      presentations.set(variable.variableId, {
        kind: 'error',
        text: '???',
        message: 'Variable expression result is unavailable.',
      })
      continue
    }

    presentations.set(variable.variableId, {
      kind: 'success',
      text: formatVariableResult(evaluatedValue),
    })
  }

  return presentations
}

export function FeatureSidebar({
  snapshot,
  hiddenTargetKeys,
  invalidVariableValueIds = {},
  invalidVariableValueMessages = {},
  objectLabelOverrides,
  onAddVariable,
  onInspectDiagnostic,
  onObjectDelete,
  onObjectExport,
  onRenameTarget,
  onReopenTarget,
  onSelectTarget,
  onToggleTargetVisibility,
  onUpdateVariable,
  visibleSelection,
}: FeatureSidebarProps) {
  const {
    state: { selection, selectionFilter, selectionCatalog },
  } = useEditorState()
  const [editingVariableId, setEditingVariableId] = useState<string | null>(null)
  const [variableDrafts, setVariableDrafts] = useState<Record<string, Pick<DocumentVariableRecord, 'name' | 'valueText'>>>({})
  const previousVariableIdsRef = useRef<Set<string> | null>(null)
  const variableResultPresentations = useMemo(
    () => getVariableResultPresentations(snapshot?.document.variables ?? [], invalidVariableValueIds, invalidVariableValueMessages),
    [invalidVariableValueIds, invalidVariableValueMessages, snapshot],
  )

  useEffect(() => {
    if (!snapshot) {
      previousVariableIdsRef.current = null
      return
    }

    const previousVariableIds = previousVariableIdsRef.current
    const variables = snapshot.document.variables
    if (previousVariableIds) {
      const addedVariable = variables.find((variable) => !previousVariableIds.has(variable.variableId))
      if (addedVariable) {
        setEditingVariableId(addedVariable.variableId)
      }
    }
    previousVariableIdsRef.current = new Set(variables.map((variable) => variable.variableId))
  }, [snapshot])

  const getVariableDraft = (variable: DocumentVariableRecord) =>
    variableDrafts[variable.variableId] ?? {
      name: variable.name,
      valueText: variable.valueText,
    }

  const patchVariableDraft = (
    variable: DocumentVariableRecord,
    patch: Partial<Pick<DocumentVariableRecord, 'name' | 'valueText'>>,
  ) => {
    setVariableDrafts((current) => ({
      ...current,
      [variable.variableId]: {
        ...getVariableDraft(variable),
        ...patch,
      },
    }))
  }

  const resetVariableDraft = (variable: DocumentVariableRecord) => {
    setVariableDrafts((current) => {
      const next = { ...current }
      delete next[variable.variableId]
      return next
    })
  }

  const commitVariableDraft = (variable: DocumentVariableRecord) => {
    const draft = getVariableDraft(variable)
    if (draft.name !== variable.name || draft.valueText !== variable.valueText) {
      onUpdateVariable(variable, draft)
    }
    resetVariableDraft(variable)
  }

  const finishVariableEdit = (variable: DocumentVariableRecord) => {
    commitVariableDraft(variable)
    setEditingVariableId(null)
  }

  const cancelVariableEdit = (variable: DocumentVariableRecord) => {
    resetVariableDraft(variable)
    setEditingVariableId(null)
  }

  return (
    <Paper
      component="aside"
      radius={0}
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{
        background: 'var(--workbench-shell-surface-panel)',
        borderRight: '1px solid var(--workbench-shell-border)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <section
        className="grid min-h-0 flex-[1.35] grid-rows-[minmax(0,1.1fr)_minmax(0,0.9fr)] overflow-hidden"
        style={{ borderBottom: '1px solid var(--workbench-shell-border)' }}
      >
        <div
          className="flex min-h-0 flex-col overflow-hidden"
          style={{ borderBottom: '1px solid var(--workbench-shell-border)' }}
        >
          <header className="px-4 py-3" style={{ borderBottom: '1px solid var(--workbench-shell-border)' }}>
            <Text size="11px" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.22em' }}>
              Parts & Objects
            </Text>
          </header>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 px-3 py-3">
              {(snapshot?.presentation.objects ?? []).map((item) => {
                const target = item.target
                const targetKey = getPrimitiveRefKey(target)
                const itemLabel = objectLabelOverrides[targetKey] ?? item.label
                const isHidden = hiddenTargetKeys[targetKey] === true
                const isSelected =
                  visibleSelection.some((entry) => getPrimitiveRefKey(entry) === targetKey)
                const isAllowed = selectionFilterAllowsTarget(selectionFilter, selection, target, selectionCatalog)
                const menuItems: WorkbenchContextMenuEntry[] = [
                  {
                    kind: 'item',
                    id: 'rename',
                    label: 'Rename',
                    commandId: 'context.rename',
                    icon: <WorkbenchIcon name="type" className="h-3.5 w-3.5" />,
                    onSelect: () => onRenameTarget(target, itemLabel),
                  },
                  {
                    kind: 'item',
                    id: 'delete',
                    label: 'Delete',
                    commandId: 'context.delete',
                    icon: <WorkbenchIcon name="trash" className="h-3.5 w-3.5" />,
                    danger: true,
                    onSelect: () => onObjectDelete(target, itemLabel),
                  },
                  {
                    kind: 'item',
                    id: 'export',
                    label: 'Export',
                    commandId: 'context.export',
                    icon: <WorkbenchIcon name="download" className="h-3.5 w-3.5" />,
                    onSelect: () => onObjectExport(target, itemLabel),
                  },
                ]

                return (
                  <WorkbenchContextMenu key={item.id} label={`${itemLabel} actions`} items={menuItems}>
                    <div
                      className={`-mx-3 flex items-center gap-2 px-5 py-1.5 transition hover:bg-[var(--workbench-shell-accent-surface)] ${
                        isSelected ? 'bg-[var(--workbench-shell-accent-surface)]' : ''
                      } ${isHidden ? 'opacity-55' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!isAllowed || isHidden) {
                            return
                          }
                          onSelectTarget(target)
                        }}
                        onDoubleClick={() => {
                          if (target.kind === 'feature' || target.kind === 'sketch') {
                            onReopenTarget(target)
                          }
                        }}
                        className={`min-w-0 flex-1 text-left ${
                          !isAllowed || isHidden ? 'cursor-not-allowed opacity-45' : ''
                        }`}
                        aria-disabled={!isAllowed || isHidden}
                        title={
                          isHidden
                            ? 'Hidden in the viewport'
                            : target.kind === 'feature' || target.kind === 'sketch'
                                ? 'Double-click to reopen authoring in place'
                                : !isAllowed
                                  ? 'Filtered out by the current command'
                                  : undefined
                        }
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="flex h-4 w-4 shrink-0 items-center justify-center"
                            style={{ color: 'var(--mantine-color-workbench-4)' }}
                          >
                            {item.kind === 'body' ? (
                              <WorkbenchIcon name="box" className="h-3.5 w-3.5" />
                            ) : item.kind === 'sketch' ? (
                              <WorkbenchIcon name="pencilRuler" className="h-3.5 w-3.5" />
                            ) : (
                              <WorkbenchIcon name="component" className="h-3.5 w-3.5" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium leading-5 text-[var(--mantine-color-dark-0)]">
                              {itemLabel}
                            </p>
                          </div>
                        </div>
                      </button>
                      <ActionIcon
                        component="button"
                        onClick={() => onToggleTargetVisibility(target)}
                        variant="subtle"
                        color="gray"
                        size={24}
                        aria-label={isHidden ? `Show ${itemLabel}` : `Hide ${itemLabel}`}
                        title={isHidden ? 'Show in viewport' : 'Hide from viewport'}
                      >
                        <WorkbenchIcon name={isHidden ? 'eyeClosed' : 'eyeOpen'} className="h-3.5 w-3.5" />
                      </ActionIcon>
                    </div>
                  </WorkbenchContextMenu>
                )
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--workbench-shell-border)' }}>
            <Text size="11px" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.22em' }}>
              Variables
            </Text>
            <Tooltip label="Add variable" withArrow>
              <ActionIcon
                type="button"
                variant="subtle"
                color="gray"
                size={24}
                aria-label="Add variable"
                onClick={onAddVariable}
              >
                <WorkbenchIcon name="plus" className="h-3.5 w-3.5" />
              </ActionIcon>
            </Tooltip>
          </header>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 px-3 py-3">
              {(snapshot?.document.variables ?? []).map((variable) => {
                const draft = getVariableDraft(variable)
                const variableResult = variableResultPresentations.get(variable.variableId) ?? {
                  kind: 'error',
                  text: '???',
                  message: 'Variable expression result is unavailable.',
                }
                const isValueInvalid = variableResult.kind === 'error'
                const isEditingVariable = editingVariableId === variable.variableId || variable.valueText === ''
                const variableResultChip = (
                  <span
                    className="min-w-12 shrink-0 truncate rounded border px-2 py-1 text-right font-mono text-[12px] leading-4"
                    aria-label={
                      variableResult.kind === 'error'
                        ? `Variable result error: ${variableResult.message}`
                        : `Variable result: ${variableResult.text}`
                    }
                    data-variable-result={variable.variableId}
                    data-result-state={variableResult.kind}
                    style={{
                      backgroundColor:
                        variableResult.kind === 'error'
                          ? 'var(--workbench-shell-danger-surface)'
                          : 'var(--workbench-shell-success-surface)',
                      borderColor:
                        variableResult.kind === 'error'
                          ? 'var(--workbench-shell-danger-border)'
                          : 'var(--workbench-shell-success-border)',
                      color:
                        variableResult.kind === 'error'
                          ? 'var(--workbench-shell-danger-text)'
                          : 'var(--workbench-shell-success-text)',
                    }}
                  >
                    {variableResult.text}
                  </span>
                )

                return (
                  <div
                    key={variable.variableId}
                    className="rounded-md border"
                    data-variable-row={variable.variableId}
                    data-invalid-value={isValueInvalid ? 'true' : undefined}
                    data-variable-editing={isEditingVariable ? 'true' : undefined}
                    style={{
                      backgroundColor: isValueInvalid
                        ? 'var(--workbench-shell-danger-surface)'
                        : 'transparent',
                      borderColor: isValueInvalid
                        ? 'var(--workbench-shell-danger-border)'
                        : 'transparent',
                    }}
                  >
                    {isEditingVariable ? (
                      <div
                        className="grid grid-cols-[minmax(0,1fr)_minmax(5rem,0.75fr)] gap-2 px-2 py-1.5"
                        onBlur={(event) => {
                          const nextFocusTarget = event.relatedTarget
                          if (nextFocusTarget instanceof Node && event.currentTarget.contains(nextFocusTarget)) {
                            return
                          }
                          finishVariableEdit(variable)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            finishVariableEdit(variable)
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            cancelVariableEdit(variable)
                          }
                        }}
                      >
                        <input
                          aria-label={`Variable name ${variable.variableId}`}
                          autoFocus
                          className="h-7 min-w-0 rounded border bg-[var(--workbench-shell-overlay)] px-2 text-[13px] font-medium text-[var(--mantine-color-dark-0)] outline-none focus:border-[var(--workbench-shell-accent)]"
                          style={{ borderColor: 'var(--workbench-shell-border)' }}
                          value={draft.name}
                          onChange={(event) => patchVariableDraft(variable, { name: event.currentTarget.value })}
                        />
                        <input
                          aria-label={`Variable value ${variable.variableId}`}
                          className="h-7 min-w-0 rounded border px-2 font-mono text-xs text-[var(--mantine-color-dark-1)] outline-none focus:border-[var(--workbench-shell-accent)]"
                          style={{
                            backgroundColor: 'var(--mantine-color-dark-8)',
                            borderColor: isValueInvalid
                              ? 'var(--workbench-shell-danger-border)'
                              : 'var(--workbench-shell-border)',
                          }}
                          value={draft.valueText}
                          onChange={(event) => patchVariableDraft(variable, { valueText: event.currentTarget.value })}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-[var(--workbench-shell-accent-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--workbench-shell-accent)]"
                        style={{
                          backgroundColor: 'transparent',
                          border: 0,
                        }}
                        aria-label={`Edit variable ${variable.variableId}`}
                        onDoubleClick={() => setEditingVariableId(variable.variableId)}
                      >
                        <span className="min-w-0 truncate text-[13px] font-medium leading-5 text-[var(--mantine-color-dark-0)]">
                          {variable.name || 'Unnamed variable'}
                        </span>
                        <span className="ml-auto flex min-w-0 max-w-[68%] shrink-0 items-center justify-end gap-1.5">
                          <span
                            className="min-w-0 truncate rounded border px-2 py-1 text-right font-mono text-[12px] leading-4 text-[var(--mantine-color-dark-1)]"
                            data-variable-expression={variable.variableId}
                            style={{
                              backgroundColor: 'var(--mantine-color-dark-8)',
                              borderColor: 'var(--workbench-shell-border)',
                            }}
                          >
                            {variable.valueText}
                          </span>
                          {variableResult.kind === 'error' ? (
                            <Tooltip
                              label={variableResult.message}
                              opened
                              withArrow
                              multiline
                              position="right"
                              w={240}
                            >
                              {variableResultChip}
                            </Tooltip>
                          ) : variableResultChip}
                        </span>
                      </button>
                    )}
                  </div>
                )
              })}
              {snapshot && snapshot.document.variables.length === 0 ? (
                <p className="text-xs text-[var(--mantine-color-dark-2)]">No document variables.</p>
              ) : null}
            </div>
          </ScrollArea>
        </div>
      </section>

      <section
        className="flex min-h-0 max-h-56 flex-[0.85] flex-col overflow-hidden"
        style={{ borderBottom: '1px solid var(--workbench-shell-border)' }}
      >
        <header className="px-4 py-3" style={{ borderBottom: '1px solid var(--workbench-shell-border)' }}>
          <Text size="11px" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.22em' }}>
            Document Diagnostics
          </Text>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 px-3 py-3">
            {snapshot?.document.diagnostics.length ? (
              snapshot.document.diagnostics.map((diagnostic, index) => {
                const isAllowed = diagnostic.target
                  ? selectionFilterAllowsTarget(selectionFilter, selection, diagnostic.target, selectionCatalog)
                  : false
                const menuItems: WorkbenchContextMenuEntry[] = [
                  {
                    kind: 'item',
                    id: 'select-target',
                    label: 'Select target',
                    commandId: 'context.selectTarget',
                    icon: <WorkbenchIcon name="mousePointer" className="h-3.5 w-3.5" />,
                    disabled: !diagnostic.target || !isAllowed,
                    onSelect: () => {
                      if (diagnostic.target) {
                        onSelectTarget(diagnostic.target)
                      }
                    },
                  },
                  {
                    kind: 'item',
                    id: 'inspect-diagnostic',
                    label: 'Inspect diagnostic',
                    commandId: 'context.inspectDiagnostic',
                    icon: <WorkbenchIcon name="info" className="h-3.5 w-3.5" />,
                    onSelect: () => onInspectDiagnostic(diagnostic),
                  },
                ]

                return (
                  <WorkbenchContextMenu
                    key={`${diagnostic.code}-${diagnostic.message}-${index}`}
                    label={`${diagnostic.code} actions`}
                    items={menuItems}
                  >
                    <div
                      tabIndex={0}
                      className="rounded-md border px-2 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--workbench-shell-accent)]"
                      style={{
                        backgroundColor:
                          diagnostic.severity === 'error'
                            ? 'var(--workbench-shell-danger-surface)'
                            : diagnostic.severity === 'warning'
                              ? 'var(--workbench-shell-warning-surface)'
                              : 'var(--workbench-shell-overlay)',
                        borderColor:
                          diagnostic.severity === 'error'
                            ? 'var(--workbench-shell-danger-border)'
                            : diagnostic.severity === 'warning'
                              ? 'var(--workbench-shell-warning-border)'
                              : 'var(--workbench-shell-border)',
                      }}
                    >
                      <p
                        className="text-[11px] uppercase tracking-[0.18em]"
                        style={{
                          color:
                            diagnostic.severity === 'error'
                              ? 'var(--workbench-shell-danger-text)'
                              : diagnostic.severity === 'warning'
                                ? 'var(--workbench-shell-warning-text)'
                                : 'var(--workbench-shell-text-dim)',
                        }}
                      >
                        {diagnostic.severity}
                      </p>
                      <p className="mt-1 text-sm text-[var(--mantine-color-dark-0)]">{diagnostic.message}</p>
                      {diagnostic.target ? (
                        <p className="mt-1 text-xs text-[var(--mantine-color-dark-2)]">
                          Target {getPrimitiveRefLabel(diagnostic.target)}
                        </p>
                      ) : null}
                      {formatDocumentDiagnosticDetail(diagnostic) ? (
                        <p className="mt-1 text-xs text-[var(--mantine-color-dark-2)]">
                          {formatDocumentDiagnosticDetail(diagnostic)}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-[var(--mantine-color-dark-3)]">{diagnostic.code}</p>
                    </div>
                  </WorkbenchContextMenu>
                )
              })
            ) : (
              <p className="text-xs text-[var(--mantine-color-dark-2)]">No document diagnostics.</p>
            )}
          </div>
        </ScrollArea>
      </section>
    </Paper>
  )
}
