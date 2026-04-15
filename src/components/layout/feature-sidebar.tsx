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
    <aside className="flex h-full min-h-0 flex-col border-r border-[var(--cad-border)] bg-[linear-gradient(180deg,_rgba(17,21,28,0.96),_rgba(11,15,21,0.98))]">
      <section className="grid min-h-0 flex-[1.35] grid-rows-[minmax(0,1.1fr)_minmax(0,0.9fr)] border-b border-[var(--cad-border)]">
        <div className="flex min-h-0 flex-col border-b border-[var(--cad-border)]">
          <header className="border-b border-[var(--cad-border)] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--cad-muted)]">
              Parts & Objects
            </p>
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
                    className={`flex items-start gap-2 rounded-md px-2 py-1.5 transition ${
                      isSelected ? 'bg-[var(--cad-surface-elevated)]' : ''
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
                      className={`min-w-0 flex-1 text-left transition hover:bg-[var(--cad-surface-elevated)] ${
                        !isAllowed || isHidden ? 'cursor-not-allowed opacity-45' : ''
                      }`}
                      aria-disabled={!isAllowed || isHidden}
                      title={!isAllowed ? 'Filtered out by the current command' : isHidden ? 'Hidden in the viewport' : undefined}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[var(--cad-accent)]">
                          {item.kind === 'body' ? (
                            <Box className="h-3.5 w-3.5" />
                          ) : (
                            <Component className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium leading-5 text-[var(--cad-foreground)]">
                            {item.label}
                          </p>
                          {isHidden ? (
                            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--cad-muted-foreground)]">
                              Hidden
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleTargetVisibility(target)}
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--cad-muted-foreground)] transition hover:bg-[var(--cad-surface-elevated)] hover:text-[var(--cad-foreground)]"
                      aria-label={isHidden ? `Show ${item.label}` : `Hide ${item.label}`}
                      title={isHidden ? 'Show in viewport' : 'Hide from viewport'}
                    >
                      {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="flex min-h-0 flex-col">
          <header className="border-b border-[var(--cad-border)] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--cad-muted)]">
              Snapshot References
            </p>
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
                    className={`block w-full rounded-md border px-2 py-2 text-left transition hover:bg-[var(--cad-surface-elevated)] ${
                      reference.invalidation
                        ? 'border-[rgba(214,106,106,0.4)] bg-[rgba(49,22,24,0.72)]'
                        : 'border-[var(--cad-border)] bg-[rgba(10,14,20,0.72)]'
                    } ${!isAllowed ? 'cursor-not-allowed opacity-45' : ''}`}
                    aria-disabled={!isAllowed}
                    aria-label={`Select ${reference.label} ${targetLabel}`}
                    title={!isAllowed ? 'Filtered out by the current command' : undefined}
                  >
                    <span className="block truncate text-sm font-medium text-[var(--cad-foreground)]">{reference.label}</span>
                    <span className="block truncate text-xs text-[var(--cad-muted-foreground)]">
                      {targetLabel}
                    </span>
                    <span className="mt-1 block truncate text-[11px] uppercase tracking-[0.18em] text-[var(--cad-muted)]">
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

      <section className="flex min-h-0 flex-[0.85] flex-col border-b border-[var(--cad-border)]">
        <header className="border-b border-[var(--cad-border)] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--cad-muted)]">
            Document Diagnostics
          </p>
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
                        : 'border-[var(--cad-border)] bg-[rgba(10,14,20,0.72)]'
                  }`}
                >
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--cad-muted)]">
                    {diagnostic.severity}
                  </p>
                  <p className="mt-1 text-sm text-[var(--cad-foreground)]">{diagnostic.message}</p>
                  {diagnostic.target ? (
                    <p className="mt-1 text-xs text-[var(--cad-muted-foreground)]">
                      Target {getPrimitiveRefLabel(diagnostic.target)}
                    </p>
                  ) : null}
                  {formatDocumentDiagnosticDetail(diagnostic) ? (
                    <p className="mt-1 text-xs text-[var(--cad-muted-foreground)]">
                      {formatDocumentDiagnosticDetail(diagnostic)}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-[var(--cad-muted)]">{diagnostic.code}</p>
                </div>
              ))
            ) : (
              <p className="text-xs text-[var(--cad-muted-foreground)]">No document diagnostics.</p>
            )}
          </div>
        </ScrollArea>
      </section>

    </aside>
  )
}
