import type {
  SketchToolFloatingInputDescriptor,
  SketchToolOverlayDescriptor,
  SketchToolPresentationSchema,
} from '@/domain/sketch-tools/editor-schema'
import {
  getFloatingInputProjectionId,
  getOverlayProjectionId,
  type SketchViewportFeedbackProjection,
} from '@/components/cad/sketch-viewport-feedback-model'

interface SketchViewportFeedbackLayerProps {
  schema: SketchToolPresentationSchema | null
  projections: readonly SketchViewportFeedbackProjection[]
  onPatch: (patch: Record<string, unknown>) => void
}

export function SketchViewportFeedbackLayer({
  schema,
  projections,
  onPatch,
}: SketchViewportFeedbackLayerProps) {
  if (!schema) {
    return null
  }

  const projectionById = new Map(projections.map((projection) => [projection.id, projection]))
  const overlays = schema.overlays ?? []

  if (overlays.length === 0 && !schema.floatingInput) {
    return null
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {overlays.map((overlay) => {
        const projection = projectionById.get(getOverlayProjectionId(overlay.id))

        if (!projection) {
          return null
        }

        return (
          <div
            key={overlay.id}
            data-sketch-viewport-overlay={overlay.kind}
            className={getOverlayClassName(overlay)}
            style={{
              left: projection.x,
              top: projection.y,
              transform: 'translate(-50%, -50%)',
            }}
          >
            {getOverlayContent(overlay)}
          </div>
        )
      })}
      {schema.floatingInput ? (
        <ViewportFloatingInput
          descriptor={schema.floatingInput}
          projection={projectionById.get(getFloatingInputProjectionId(schema.floatingInput.id))}
          onPatch={onPatch}
        />
      ) : null}
    </div>
  )
}

function getOverlayClassName(overlay: SketchToolOverlayDescriptor) {
  const baseClassName = 'absolute max-w-[180px] whitespace-nowrap rounded border px-2 py-1 text-[11px] leading-none shadow-[var(--cad-panel-shadow)]'

  if (overlay.kind === 'completionCue') {
    return `${baseClassName} border-[var(--cad-border)] bg-[var(--cad-surface-overlay)] text-[var(--cad-muted-foreground)]`
  }

  return `${baseClassName} border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] text-[var(--cad-foreground)]`
}

function getOverlayContent(overlay: SketchToolOverlayDescriptor) {
  switch (overlay.kind) {
    case 'measurement':
      return (
        <>
          <span className="text-[var(--cad-muted-foreground)]">{overlay.label}</span>
          <span className="ml-2 font-mono">
            {overlay.value.toFixed(2)} {overlay.unit ?? ''}
          </span>
        </>
      )
    case 'constraintPreview':
      return (
        <>
          <span>{overlay.label}</span>
          <span className="ml-2 text-[var(--cad-muted-foreground)]">{overlay.detail}</span>
        </>
      )
    case 'completionCue':
      return overlay.ready ? overlay.label : 'waiting'
    case 'anchor':
    case 'helperMarker':
      return overlay.label
  }
}

function ViewportFloatingInput({
  descriptor,
  projection,
  onPatch,
}: {
  descriptor: SketchToolFloatingInputDescriptor
  projection: SketchViewportFeedbackProjection | undefined
  onPatch: (patch: Record<string, unknown>) => void
}) {
  if (!projection) {
    return null
  }

  return (
    <div
      className="pointer-events-auto absolute w-[220px] rounded-lg border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] p-3 text-xs text-[var(--cad-muted-foreground)] shadow-[var(--cad-panel-shadow)]"
      data-sketch-viewport-floating-input={descriptor.id}
      style={{
        left: projection.x,
        top: projection.y,
        transform: 'translate(0, -100%)',
      }}
    >
      <div className="text-sm font-medium text-[var(--cad-foreground)]">{descriptor.label}</div>
      <input
        autoFocus
        className="mt-2 h-9 w-full rounded-md border border-[var(--cad-border)] bg-[var(--cad-surface)] px-2 text-[var(--cad-foreground)] outline-none"
        defaultValue={descriptor.value?.toString() ?? ''}
        key={descriptor.id}
        min={descriptor.min}
        step="any"
        type="number"
        onChange={(event) => {
          const nextValue = Number(event.currentTarget.value)
          onPatch({
            value: Number.isNaN(nextValue) ? null : nextValue,
          })
        }}
      />
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex-1 rounded-md border border-[var(--cad-border)] px-2 py-1 text-[var(--cad-foreground)]"
          onClick={() => onPatch(descriptor.cancelAction.patch)}
        >
          {descriptor.cancelLabel}
        </button>
        <button
          type="button"
          className="flex-1 rounded-md border border-[var(--cad-border-strong)] bg-[var(--cad-surface-elevated)] px-2 py-1 text-[var(--cad-foreground)]"
          onClick={() => onPatch(descriptor.submitAction.patch)}
        >
          {descriptor.confirmLabel}
        </button>
      </div>
    </div>
  )
}
