import type { SketchAnnotationDescriptor } from '@/domain/editor/sketch-session'
import type { SketchConstraintRef, SketchDimensionRef } from '@/contracts/shared/references'

interface SketchConstraintAnnotationsProps {
  annotations: readonly SketchAnnotationDescriptor[]
  selectedAnnotation: SketchConstraintRef | SketchDimensionRef | null
  onSelect: (target: SketchConstraintRef | SketchDimensionRef) => void
}

export function SketchConstraintAnnotations({
  annotations,
  selectedAnnotation,
  onSelect,
}: SketchConstraintAnnotationsProps) {
  if (annotations.length === 0) {
    return null
  }

  return (
    <div className="pointer-events-auto absolute right-4 top-28 z-10 grid max-w-[280px] gap-2 rounded-xl border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] p-2 text-xs text-[var(--cad-muted-foreground)] shadow-[var(--cad-panel-shadow)]">
      {annotations.map((annotation) => {
        const isSelected = (() => {
          if (annotation.target.kind === 'constraint') {
            if (!selectedAnnotation || selectedAnnotation.kind !== 'constraint') {
              return false
            }

            return selectedAnnotation.constraintId === annotation.target.constraintId
          }

          if (!selectedAnnotation || selectedAnnotation.kind !== 'dimension') {
            return false
          }

          return selectedAnnotation.dimensionId === annotation.target.dimensionId
        })()

        return (
          <button
            key={annotation.id}
            type="button"
            className={`rounded-lg border px-2 py-1 text-left transition ${
              isSelected
                ? 'border-[var(--cad-border-strong)] bg-[var(--cad-surface-elevated)] text-[var(--cad-foreground)]'
                : 'border-[var(--cad-border)] hover:border-[var(--cad-border-strong)] hover:text-[var(--cad-foreground)]'
            }`}
            onClick={() => onSelect(annotation.target)}
          >
            <div className="font-medium">{annotation.label}</div>
            <div>{annotation.detail}</div>
          </button>
        )
      })}
    </div>
  )
}
