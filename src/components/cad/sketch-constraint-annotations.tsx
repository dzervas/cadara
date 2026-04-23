import type { SketchAnnotationDescriptor } from '@/domain/editor/sketch-session'
import type { SketchConstraintRef, SketchDimensionRef } from '@/contracts/shared/references'
import { getToolIconSrc } from '@/domain/tools/tool-icons'
import {
  getAnnotationProjectionId,
  layoutSketchAnnotationProjections,
  type SketchViewportFeedbackProjection,
} from '@/components/cad/sketch-viewport-feedback-model'
import { getSketchRenderingPaletteToken } from '@/components/cad/sketch-rendering-palette'

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
    <div className="pointer-events-none absolute inset-0 z-30">
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
              borderColor: getAnnotationConstraintColor(annotation),
              color: getAnnotationConstraintColor(annotation),
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

function getAnnotationConstraintColor(annotation: SketchAnnotationDescriptor) {
  if (annotation.constraintDisplay?.isAffectedOverconstraint) {
    return `var(${getSketchRenderingPaletteToken('overconstrained')})`
  }

  if (annotation.constraintDisplay?.state === 'constrained') {
    return `var(${getSketchRenderingPaletteToken('constrained')})`
  }

  return `var(${getSketchRenderingPaletteToken('underconstrained')})`
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
      return getToolIconSrc('constraintCoincident')
    case 'constraintParallel':
      return getToolIconSrc('constraintParallel')
    case 'constraintEqual':
      return getToolIconSrc('constraintEqual')
    case 'constraintHorizontal':
      return '/icons/sketch-horizontal.svg'
    case 'constraintVertical':
      return '/icons/sketch-vertical.svg'
    case 'constraintFixed':
      return getToolIconSrc('constraintFix')
    case 'constraintAngle':
      return '/icons/drawing-angular-dim-line-to-line.svg'
    case 'constraintPerpendicular':
      return '/icons/sketch-perpendicular.svg'
    case 'constraintTangent':
      return '/icons/sketch-tangent.svg'
    case 'constraintConcentric':
      return getToolIconSrc('constraintConcentric')
    case 'constraintMidpoint':
      return getToolIconSrc('constraintMidpoint')
    case 'constraintNormal':
      return getToolIconSrc('constraintNormal')
    case 'constraintPierce':
      return getToolIconSrc('constraintPierce')
    case 'constraintSymmetric':
      return getToolIconSrc('constraintSymmetric')
    case 'dimensionDistance':
      return getToolIconSrc('dimension')
    case 'dimensionHorizontal':
      return getToolIconSrc('dimension')
    case 'dimensionVertical':
      return getToolIconSrc('dimension')
    case 'dimensionRadius':
      return getToolIconSrc('dimension')
    case 'dimensionCoincident':
      return getToolIconSrc('dimension')
  }
}
