import { ActionIcon, Paper, Text } from '@mantine/core'
import { Box, Component, Eye, EyeOff } from 'lucide-react'

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
        background: 'linear-gradient(180deg, rgba(17, 21, 28, 0.96), rgba(11, 15, 21, 0.98))',
        borderRight: '1px solid var(--mantine-color-dark-5)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <section
        className="grid min-h-0 flex-[1.35] grid-rows-[minmax(0,1.1fr)_minmax(0,0.9fr)] overflow-hidden"
        style={{ borderBottom: '1px solid var(--mantine-color-dark-5)' }}
      >
        <div
          className="flex min-h-0 flex-col overflow-hidden"
          style={{ borderBottom: '1px solid var(--mantine-color-dark-5)' }}
        >
          <header className="px-4 py-3" style={{ borderBottom: '1px solid var(--mantine-color-dark-5)' }}>
            <Text size="11px" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.22em' }}>
              Parts & Objects
            </Text>
          </header>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 px-3 py-3">
              {(snapshot?.presentation.objects ?? []).map((item) => {
                const target = item.target
                const targetKey = getPrimitiveRefKey(target)
                const isHidden = hiddenTargetKeys[targetKey] === true
                const isSelected =
                  visibleSelection.some((entry) => getPrimitiveRefKey(entry) === targetKey)
                const isAllowed = selectionFilterAllowsTarget(selectionFilter, selection, target, selectionCatalog)

                return (
                  <div
                    key={item.id}
                    className={`-mx-3 flex items-start gap-2 px-5 py-1.5 transition hover:bg-[rgba(94,130,171,0.18)] ${
                      isSelected ? 'bg-[rgba(94,130,171,0.18)]' : ''
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
                      className={`min-w-0 flex-1 text-left ${
                        !isAllowed || isHidden ? 'cursor-not-allowed opacity-45' : ''
                      }`}
                      aria-disabled={!isAllowed || isHidden}
                      title={!isAllowed ? 'Filtered out by the current command' : isHidden ? 'Hidden in the viewport' : undefined}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center"
                          style={{ color: 'var(--mantine-color-workbench-4)' }}
                        >
                          {item.kind === 'body' ? (
                            <Box className="h-3.5 w-3.5" />
                          ) : (
                            <Component className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium leading-5 text-[var(--mantine-color-dark-0)]">
                            {item.label}
                          </p>
                        </div>
                      </div>
                    </button>
                    <ActionIcon
                      component="button"
                      onClick={() => onToggleTargetVisibility(target)}
                      className="mt-0.5"
                      variant="subtle"
                      color="gray"
                      size={24}
                      aria-label={isHidden ? `Show ${item.label}` : `Hide ${item.label}`}
                      title={isHidden ? 'Show in viewport' : 'Hide from viewport'}
                    >
                      {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </ActionIcon>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden">
          <header className="px-4 py-3" style={{ borderBottom: '1px solid var(--mantine-color-dark-5)' }}>
            <Text size="11px" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.22em' }}>
              Snapshot References
            </Text>
          </header>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 px-3 py-3">
              {(snapshot?.document.references ?? []).map((reference) => {
                const isAllowed = selectionFilterAllowsTarget(selectionFilter, selection, reference.target, selectionCatalog)
                const targetLabel = getPrimitiveRefLabel(reference.target)

                return (
                  <button
                    key={reference.id}
                    type="button"
                    onClick={() => {
                      if (!isAllowed) {
                        return
                      }
                      onSelectTarget(reference.target)
                    }}
                    className={`block w-full rounded-md border px-2 py-2 text-left transition hover:bg-[rgba(94,130,171,0.18)] ${
                      reference.invalidation
                        ? 'border-[rgba(214,106,106,0.4)] bg-[rgba(49,22,24,0.72)]'
                        : 'border-[var(--mantine-color-dark-5)] bg-[rgba(10,14,20,0.72)]'
                    } ${!isAllowed ? 'cursor-not-allowed opacity-45' : ''}`}
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
                      <span className="mt-1 block text-xs text-[rgb(241,160,160)]">{getReferenceStatus(reference)}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        </div>
      </section>

      <section
        className="flex min-h-0 flex-[0.85] flex-col overflow-hidden"
        style={{ borderBottom: '1px solid var(--mantine-color-dark-5)' }}
      >
        <header className="px-4 py-3" style={{ borderBottom: '1px solid var(--mantine-color-dark-5)' }}>
          <Text size="11px" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.22em' }}>
            Document Diagnostics
          </Text>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 px-3 py-3">
            {snapshot?.document.diagnostics.length ? (
              snapshot.document.diagnostics.map((diagnostic, index) => (
                <div
                  key={`${diagnostic.code}-${diagnostic.message}-${index}`}
                  className={`rounded-md border px-2 py-2 ${
                    diagnostic.severity === 'error'
                      ? 'border-[rgba(214,106,106,0.45)] bg-[rgba(49,22,24,0.72)]'
                      : diagnostic.severity === 'warning'
                        ? 'border-[rgba(196,152,84,0.45)] bg-[rgba(46,33,17,0.72)]'
                        : 'border-[var(--mantine-color-dark-5)] bg-[rgba(10,14,20,0.72)]'
                  }`}
                >
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--mantine-color-dark-3)]">
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
              ))
            ) : (
              <p className="text-xs text-[var(--mantine-color-dark-2)]">No document diagnostics.</p>
            )}
          </div>
        </ScrollArea>
      </section>
    </Paper>
  )
}
