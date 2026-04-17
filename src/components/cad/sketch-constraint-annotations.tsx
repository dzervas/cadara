import type { SketchAnnotationDescriptor } from '@/domain/editor/sketch-session'
import type { SketchConstraintRef, SketchDimensionRef } from '@/contracts/shared/references'
import { getToolbarToolIconSrc } from '@/components/layout/toolbar-tool-icon-src'
import {
  getAnnotationProjectionId,
  layoutSketchAnnotationProjections,
  type SketchViewportFeedbackProjection,
} from '@/components/cad/sketch-viewport-feedback-model'

interface SketchConstraintAnnotationsProps {
  annotations: readonly SketchAnnotationDescriptor[]
  projections: readonly SketchViewportFeedbackProjection[]
  hoveredAnnotation: SketchConstraintRef | SketchDimensionRef | null
  selectedAnnotation: SketchConstraintRef | SketchDimensionRef | null
  onHover: (target: SketchConstraintRef | SketchDimensionRef) => void
  onClearHover: () => void
  onSelect: (target: SketchConstraintRef | SketchDimensionRef) => void
  onEdit: (target: SketchConstraintRef | SketchDimensionRef) => void
}

export function SketchConstraintAnnotations({
  annotations,
  projections,
  hoveredAnnotation,
  selectedAnnotation,
  onHover,
  onClearHover,
  onSelect,
  onEdit,
}: SketchConstraintAnnotationsProps) {
  if (annotations.length === 0) {
    return null
  }

  const projectionById = new Map(
    layoutSketchAnnotationProjections(projections).map((projection) => [projection.id, projection]),
  )

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {annotations.map((annotation) => {
        const projection = projectionById.get(getAnnotationProjectionId(annotation.id))

        if (!projection) {
          return null
        }

        const isSelected = annotationTargetsEqual(selectedAnnotation, annotation.target)
        const isHovered = annotationTargetsEqual(hoveredAnnotation, annotation.target)
        const iconSrc = getAnnotationGlyphIconSrc(annotation.glyphKind)

        return (
          <button
            key={annotation.id}
            type="button"
            data-sketch-annotation-glyph={annotation.glyphKind}
            className={`pointer-events-auto absolute flex h-8 w-8 items-center justify-center rounded border p-1 shadow-[var(--cad-panel-shadow)] transition ${
              isSelected
                ? 'border-[var(--cad-accent)] bg-[var(--cad-surface-elevated)]'
                : isHovered
                  ? 'border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)]'
                  : 'border-[var(--cad-border)] bg-[var(--cad-surface-overlay)] hover:border-[var(--cad-border-strong)]'
            }`}
            style={{
              left: projection.x,
              top: projection.y,
              transform: 'translate(-50%, -50%)',
            }}
            aria-label={`${annotation.label}: ${annotation.detail}`}
            title={`${annotation.label}: ${annotation.detail}`}
            onPointerEnter={() => onHover(annotation.target)}
            onPointerLeave={onClearHover}
            onClick={() => onSelect(annotation.target)}
            onDoubleClick={(event) => {
              event.preventDefault()
              onEdit(annotation.target)
            }}
          >
            <img
              alt=""
              aria-hidden="true"
              className="h-5 w-5"
              draggable={false}
              src={iconSrc}
            />
          </button>
        )
      })}
    </div>
  )
}

function annotationTargetsEqual(
  left: SketchConstraintRef | SketchDimensionRef | null,
  right: SketchConstraintRef | SketchDimensionRef,
) {
  if (!left || left.kind !== right.kind || left.sketchId !== right.sketchId) {
    return false
  }

  return left.kind === 'constraint'
    ? right.kind === 'constraint' && left.constraintId === right.constraintId
    : right.kind === 'dimension' && left.dimensionId === right.dimensionId
}

function getAnnotationGlyphIconSrc(glyphKind: SketchAnnotationDescriptor['glyphKind']) {
  switch (glyphKind) {
    case 'constraintCoincident':
      return getToolbarToolIconSrc('constraintCoincident')
    case 'constraintParallel':
      return getToolbarToolIconSrc('constraintParallel')
    case 'constraintEqual':
      return getToolbarToolIconSrc('constraintEqual')
    case 'constraintHorizontal':
      return '/icons/sheet-width.svg'
    case 'constraintVertical':
      return '/icons/sheet-height.svg'
    case 'constraintFixed':
      return '/icons/sketch-fix.svg'
    case 'constraintAngle':
      return '/icons/drawing-angular-dim-line-to-line.svg'
    case 'constraintPerpendicular':
      return '/icons/sketch-perpendicular.svg'
    case 'dimensionDistance':
      return getToolbarToolIconSrc('dimension')
    case 'dimensionHorizontal':
      return getToolbarToolIconSrc('dimension')
    case 'dimensionVertical':
      return getToolbarToolIconSrc('dimension')
    case 'dimensionRadius':
      return getToolbarToolIconSrc('dimension')
    case 'dimensionCoincident':
      return getToolbarToolIconSrc('dimension')
  }
}
