import type { SketchToolPresentationSchema } from '@/domain/sketch-tools/editor-schema'

interface SketchToolOverlaysProps {
  schema: SketchToolPresentationSchema | null
}

export function SketchToolOverlays({ schema }: SketchToolOverlaysProps) {
  const overlays = schema?.overlays ?? []

  if (overlays.length === 0) {
    return null
  }

  return (
    <div className="pointer-events-none absolute right-4 bottom-4 grid max-w-[280px] gap-1 rounded-lg border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] p-2 text-xs text-[var(--cad-muted-foreground)] shadow-[var(--cad-panel-shadow)]">
      {overlays.map((overlay) => (
        <div key={overlay.id} className="flex items-center justify-between gap-3">
          <span className="text-[var(--cad-foreground)]">{overlay.label}</span>
          <span>
            {overlay.kind === 'measurement'
              ? `${overlay.value.toFixed(2)} ${overlay.unit ?? ''}`
              : overlay.kind === 'constraintPreview'
                ? overlay.detail
                : overlay.kind === 'dimensionLine'
                  ? overlay.referenceKind
                : overlay.kind === 'angleArc'
                  ? (overlay.referenceLabel ?? 'angle')
                : overlay.kind === 'extensionLine' || overlay.kind === 'referenceLabel'
                  ? overlay.label
                : overlay.kind === 'completionCue'
                ? overlay.ready ? 'ready' : 'waiting'
                : `${overlay.point[0].toFixed(2)}, ${overlay.point[1].toFixed(2)}`}
          </span>
        </div>
      ))}
    </div>
  )
}
