import type {
  SketchToolFloatingInputDescriptor,
  SketchToolOverlayDescriptor,
  SketchToolPresentationSchema,
} from '@/domain/sketch-tools/editor-schema'
import {
  getFloatingInputProjectionId,
  getOverlayGeometryProjectionId,
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
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      >
        {overlays.map((overlay) => renderOverlayGeometry(overlay, projectionById))}
      </svg>
      {overlays.map((overlay) => {
        const projection = projectionById.get(getOverlayProjectionId(overlay.id))

        if (!projection || !shouldRenderOverlayLabel(overlay)) {
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

  if (overlay.kind === 'dimensionLine' || overlay.kind === 'angleArc' || overlay.kind === 'referenceLabel') {
    return `${baseClassName} border-[var(--cad-accent)] bg-[var(--cad-surface-overlay)] font-mono text-[var(--cad-foreground)]`
  }

  if (overlay.kind === 'snapIndicator') {
    return `${baseClassName} border-[var(--cad-accent)] bg-[var(--cad-surface-overlay)] font-mono text-[var(--cad-foreground)]`
  }

  return `${baseClassName} border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] text-[var(--cad-foreground)]`
}

function getOverlayContent(overlay: SketchToolOverlayDescriptor) {
  switch (overlay.kind) {
    case 'dimensionLine':
      return (
        <>
          <span>{overlay.label}</span>
          {overlay.value === null || overlay.value === undefined ? null : (
            <span className="ml-2 text-[var(--cad-muted-foreground)]">
              {overlay.value.toFixed(2)} {overlay.unit ?? ''}
            </span>
          )}
        </>
      )
    case 'angleArc':
      return (
        <>
          <span>{overlay.label}</span>
          {overlay.referenceLabel ? (
            <span className="ml-2 text-[var(--cad-muted-foreground)]">{overlay.referenceLabel}</span>
          ) : null}
        </>
      )
    case 'referenceLabel':
      return overlay.label
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
    case 'snapIndicator':
      return overlay.label
    case 'completionCue':
      return overlay.ready ? overlay.label : 'waiting'
    case 'extensionLine':
      return null
    case 'anchor':
    case 'helperMarker':
      return overlay.label
  }
}

function shouldRenderOverlayLabel(overlay: SketchToolOverlayDescriptor) {
  return (
    overlay.kind === 'measurement'
    || overlay.kind === 'dimensionLine'
    || overlay.kind === 'angleArc'
    || overlay.kind === 'referenceLabel'
    || overlay.kind === 'snapIndicator'
  )
}

function renderOverlayGeometry(
  overlay: SketchToolOverlayDescriptor,
  projectionById: Map<string, SketchViewportFeedbackProjection>,
) {
  switch (overlay.kind) {
    case 'dimensionLine':
      return (
        <g key={overlay.id} data-sketch-viewport-geometry="dimensionLine">
          {(overlay.extensionLines ?? []).map((line) => {
            const start = projectionById.get(getOverlayGeometryProjectionId(line.id, 'start'))
            const end = projectionById.get(getOverlayGeometryProjectionId(line.id, 'end'))

            if (!start || !end) {
              return null
            }

            return (
              <line
                key={line.id}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke="var(--cad-muted-foreground)"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
            )
          })}
          {renderProjectedLine({
            id: overlay.id,
            start: projectionById.get(getOverlayGeometryProjectionId(overlay.id, 'start')),
            end: projectionById.get(getOverlayGeometryProjectionId(overlay.id, 'end')),
            stroke: 'var(--cad-accent)',
            strokeWidth: 1.5,
          })}
        </g>
      )
    case 'extensionLine':
      return renderProjectedLine({
        id: overlay.id,
        start: projectionById.get(getOverlayGeometryProjectionId(overlay.id, 'start')),
        end: projectionById.get(getOverlayGeometryProjectionId(overlay.id, 'end')),
        stroke: 'var(--cad-muted-foreground)',
        strokeWidth: 1,
      })
    case 'angleArc':
      return renderProjectedArc(overlay.id, projectionById)
    case 'snapIndicator':
      return renderSnapIndicator(overlay, projectionById.get(getOverlayProjectionId(overlay.id)))
    default:
      return null
  }
}

function renderSnapIndicator(
  overlay: Extract<SketchToolOverlayDescriptor, { kind: 'snapIndicator' }>,
  projection: SketchViewportFeedbackProjection | undefined,
) {
  if (!projection) {
    return null
  }

  const size = overlay.glyphKind === 'midpoint' ? 5 : 4

  return (
    <g key={overlay.id} data-sketch-viewport-geometry="snapIndicator" data-sketch-snap-kind={overlay.candidateKind}>
      {overlay.glyphKind === 'midpoint' ? (
        <path
          d={`M ${projection.x} ${projection.y - size} L ${projection.x + size} ${projection.y + size} L ${projection.x - size} ${projection.y + size} Z`}
          fill="none"
          stroke="var(--cad-accent)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      ) : overlay.glyphKind === 'horizontal' || overlay.glyphKind === 'vertical' ? (
        <line
          x1={projection.x - (overlay.glyphKind === 'horizontal' ? 7 : 0)}
          y1={projection.y - (overlay.glyphKind === 'vertical' ? 7 : 0)}
          x2={projection.x + (overlay.glyphKind === 'horizontal' ? 7 : 0)}
          y2={projection.y + (overlay.glyphKind === 'vertical' ? 7 : 0)}
          stroke="var(--cad-accent)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <circle
          cx={projection.x}
          cy={projection.y}
          r={size}
          fill="none"
          stroke="var(--cad-accent)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  )
}

function renderProjectedLine({
  id,
  start,
  end,
  stroke,
  strokeWidth,
}: {
  id: string
  start: SketchViewportFeedbackProjection | undefined
  end: SketchViewportFeedbackProjection | undefined
  stroke: string
  strokeWidth: number
}) {
  if (!start || !end) {
    return null
  }

  return (
    <line
      key={id}
      x1={start.x}
      y1={start.y}
      x2={end.x}
      y2={end.y}
      stroke={stroke}
      strokeWidth={strokeWidth}
      vectorEffect="non-scaling-stroke"
    />
  )
}

function renderProjectedArc(
  id: string,
  projectionById: Map<string, SketchViewportFeedbackProjection>,
) {
  const center = projectionById.get(getOverlayGeometryProjectionId(id, 'center'))
  const start = projectionById.get(getOverlayGeometryProjectionId(id, 'start'))
  const end = projectionById.get(getOverlayGeometryProjectionId(id, 'end'))

  if (!center || !start || !end) {
    return null
  }

  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x)
  const delta = normalizeArcDelta(endAngle - startAngle)
  const radius = (Math.hypot(start.x - center.x, start.y - center.y) + Math.hypot(end.x - center.x, end.y - center.y)) / 2
  const largeArcFlag = Math.abs(delta) > Math.PI ? 1 : 0
  const sweepFlag = delta >= 0 ? 1 : 0

  return (
    <path
      key={id}
      data-sketch-viewport-geometry="angleArc"
      d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`}
      fill="none"
      stroke="var(--cad-accent)"
      strokeWidth="1.5"
      vectorEffect="non-scaling-stroke"
    />
  )
}

function normalizeArcDelta(delta: number) {
  if (delta > Math.PI) {
    return delta - Math.PI * 2
  }

  if (delta < -Math.PI) {
    return delta + Math.PI * 2
  }

  return delta
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
          const nextValue = parseFloatingInputNumber(event.currentTarget.value)
          onPatch({
            value: nextValue,
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

function parseFloatingInputNumber(value: string) {
  if (value.trim() === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}
