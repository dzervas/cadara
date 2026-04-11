import type { ToolIconId } from '@/domain/tools/schema'
import { cn } from '@/lib/utils'

export const toolbarToolIconAssetMap: Record<ToolIconId, string> = {
  undo: 'undo.svg',
  redo: 'redo.svg',
  sketch: 'new-sketch.svg',
  line: 'sketch-line-segment.svg',
  rectangle: 'sketch-rectangle.svg',
  circle: 'sketch-circle.svg',
  spline: 'sketch-spline.svg',
  dimension: 'sketch-dimension.svg',
  constraintCoincident: 'sketch-coincident.svg',
  constraintParallel: 'sketch-parallel.svg',
  constraintEqual: 'sketch-equal.svg',
  extrude: 'extrude.svg',
  revolve: 'revolve.svg',
  sweep: 'sweep.svg',
  loft: 'loft.svg',
  split: 'split-part.svg',
  fillet: 'fillet.svg',
  chamfer: 'chamfer.svg',
  thicken: 'thicken.svg',
  deleteSolid: 'delete-bodies.svg',
  shell: 'shell.svg',
  linearPattern: 'linear-pattern.svg',
  circularPattern: 'circular-pattern.svg',
  curvePattern: 'curve-pattern.svg',
  moveFace: 'move-face.svg',
  mirror: 'mirror.svg',
  transform: 'transform.svg',
  measure: 'measure.svg',
  sectionView: 'SectionView-Linked.svg',
  trim: 'sketch-trim.svg',
  offset: 'sketch-offset.svg',
  finishSketch: 'check_mark.svg',
  search: 'search.svg',
  plane: 'c-plane.svg',
  combine: 'boolean-bodies.svg',
  history: 'change-history.svg',
}

interface ToolbarToolIconProps {
  icon: ToolIconId
  className?: string
}

export function ToolbarToolIcon({ icon, className }: ToolbarToolIconProps) {
  return (
    <img
      src={`/icons/${toolbarToolIconAssetMap[icon]}`}
      alt=""
      aria-hidden="true"
      className={cn('h-4 w-4 shrink-0', className)}
      loading="lazy"
      decoding="async"
    />
  )
}
