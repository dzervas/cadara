import { ActionIcon, Paper, Text } from '@mantine/core'
import { Box, Component, Download, Eye, EyeOff, Info, MousePointer2, PencilRuler, Trash2, Type } from 'lucide-react'

import { WorkbenchContextMenu, type WorkbenchContextMenuEntry } from '@/components/layout/workbench-context-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { PrimitiveRef } from '@/domain/editor/schema'
import {
  getPrimitiveRefKey,
  getPrimitiveRefLabel,
  selectionFilterAllowsTarget,
} from '@/domain/editor/schema'
import type { DocumentSnapshot, ModelingDiagnostic, ReferenceRecord } from '@/contracts/modeling/schema'
import { useEditorState } from '@/hooks/use-editor-state'

interface FeatureSidebarProps {
  hiddenTargetKeys: Record<string, boolean>
  objectLabelOverrides: Record<string, string>
  onInspectDiagnostic: (diagnostic: ModelingDiagnostic) => void
  onInspectReference: (reference: ReferenceRecord) => void
  onObjectDelete: (target: PrimitiveRef, label: string) => void
  onObjectExport: (target: PrimitiveRef, label: string) => void
  onRenameTarget: (target: PrimitiveRef, label: string) => void
  onReopenTarget: (target: PrimitiveRef) => void
  onToggleTargetVisibility: (target: PrimitiveRef) => void
  snapshot: DocumentSnapshot | null
  onSelectTarget: (target: PrimitiveRef) => void
  visibleSelection: PrimitiveRef[]
}

function formatReferenceOwner(snapshot: DocumentSnapshot, featureId: string | null, sketchId: string | null) {
  if (featureId) {
    return snapshot.document.features.find((feature) => feature.featureId === featureId)?.label ?? featureId
  }

  if (sketchId) {
    return snapshot.document.sketches.find((sketch) => sketch.sketchId === sketchId)?.label ?? sketchId
  }

  return 'Document root'
}

function getReferenceStatus(reference: ReferenceRecord) {
  if (!reference.invalidation) {
    return null
  }

  return `${getPrimitiveRefLabel(reference.invalidation.target)} invalid: ${reference.invalidation.reason}`
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

export function FeatureSidebar({
  snapshot,
  hiddenTargetKeys,
  objectLabelOverrides,
  onInspectDiagnostic,
  onInspectReference,
  onObjectDelete,
  onObjectExport,
  onRenameTarget,
  onReopenTarget,
  onSelectTarget,
  onToggleTargetVisibility,
  visibleSelection,
}: FeatureSidebarProps) {
  const {
    state: { selection, selectionFilter, selectionCatalog },
  } = useEditorState()

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
                    icon: <Type className="h-3.5 w-3.5" />,
                    onSelect: () => onRenameTarget(target, itemLabel),
                  },
                  {
                    kind: 'item',
                    id: 'delete',
                    label: 'Delete',
                    icon: <Trash2 className="h-3.5 w-3.5" />,
                    danger: true,
                    onSelect: () => onObjectDelete(target, itemLabel),
                  },
                  {
                    kind: 'item',
                    id: 'export',
                    label: 'Export',
                    icon: <Download className="h-3.5 w-3.5" />,
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
                              <Box className="h-3.5 w-3.5" />
                            ) : item.kind === 'sketch' ? (
                              <PencilRuler className="h-3.5 w-3.5" />
                            ) : (
                              <Component className="h-3.5 w-3.5" />
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
                        {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </ActionIcon>
                    </div>
                  </WorkbenchContextMenu>
                )
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden">
          <header className="px-4 py-3" style={{ borderBottom: '1px solid var(--workbench-shell-border)' }}>
            <Text size="11px" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.22em' }}>
              Snapshot References
            </Text>
          </header>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 px-3 py-3">
              {(snapshot?.document.references ?? []).map((reference) => {
                const isAllowed = selectionFilterAllowsTarget(selectionFilter, selection, reference.target, selectionCatalog)
                const targetLabel = getPrimitiveRefLabel(reference.target)
                const menuItems: WorkbenchContextMenuEntry[] = [
                  {
                    kind: 'item',
                    id: 'select-target',
                    label: 'Select target',
                    icon: <MousePointer2 className="h-3.5 w-3.5" />,
                    disabled: !isAllowed,
                    onSelect: () => onSelectTarget(reference.target),
                  },
                  {
                    kind: 'item',
                    id: 'inspect-reference',
                    label: 'Inspect reference',
                    icon: <Info className="h-3.5 w-3.5" />,
                    onSelect: () => onInspectReference(reference),
                  },
                ]

                return (
                  <WorkbenchContextMenu key={reference.id} label={`${reference.label} actions`} items={menuItems}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!isAllowed) {
                          return
                        }
                        onSelectTarget(reference.target)
                      }}
                      className={`block w-full rounded-md border px-2 py-2 text-left transition hover:bg-[var(--workbench-shell-accent-surface)] ${
                        !isAllowed ? 'cursor-not-allowed opacity-45' : ''
                      }`}
                      style={{
                        backgroundColor: reference.invalidation
                          ? 'var(--workbench-shell-danger-surface)'
                          : 'var(--workbench-shell-overlay)',
                        borderColor: reference.invalidation
                          ? 'var(--workbench-shell-danger-border)'
                          : 'var(--workbench-shell-border)',
                      }}
                      aria-disabled={!isAllowed}
                      aria-label={`Select ${reference.label} ${targetLabel}`}
                      title={!isAllowed ? 'Filtered out by the current command' : undefined}
                    >
                      <span className="block truncate text-sm font-medium text-[var(--mantine-color-dark-0)]">{reference.label}</span>
                      <span className="block truncate text-xs text-[var(--mantine-color-dark-2)]">
                        {targetLabel}
                      </span>
                      <span className="mt-1 block truncate text-[11px] uppercase tracking-[0.18em] text-[var(--mantine-color-dark-3)]">
                        Owner {snapshot ? formatReferenceOwner(snapshot, reference.ownerFeatureId, reference.ownerSketchId) : 'n/a'}
                      </span>
                      {getReferenceStatus(reference) ? (
                        <span className="mt-1 block text-xs text-[var(--workbench-shell-danger-text)]">{getReferenceStatus(reference)}</span>
                      ) : null}
                    </button>
                  </WorkbenchContextMenu>
                )
              })}
            </div>
          </ScrollArea>
        </div>
      </section>

      <section
        className="flex min-h-0 flex-[0.85] flex-col overflow-hidden"
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
                    icon: <MousePointer2 className="h-3.5 w-3.5" />,
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
                    icon: <Info className="h-3.5 w-3.5" />,
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
