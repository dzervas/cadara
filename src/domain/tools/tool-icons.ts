import type { ToolIconId } from '@/domain/tools/schema'

type SingleFileAssets = {
  icons?: Record<string, string>
}

export const toolIconAssetFileNames: Record<ToolIconId, string> = {
  undo: 'undo.svg',
  redo: 'redo.svg',
  sketch: 'new-sketch.svg',
  line: 'sketch-line-segment.svg',
  rectangle: 'sketch-rectangle.svg',
  circle: 'sketch-circle.svg',
  ellipse: 'sketch-ellipse.svg',
  ellipticalArc: 'elliptical-arc.svg',
  conic: 'sketch-conic.svg',
  bezierCurve: 'sketch-bezier.svg',
  construction: 'sketch-construction.svg',
  spline: 'sketch-spline.svg',
  controlPointSpline: 'add-spline-handle.svg',
  profileText: 'sketch-text-rectangle.svg',
  dimension: 'sketch-dimension.svg',
  constraintCoincident: 'sketch-coincident.svg',
  constraintParallel: 'sketch-parallel.svg',
  constraintPerpendicular: 'sketch-perpendicular.svg',
  constraintTangent: 'sketch-tangent.svg',
  constraintEqual: 'sketch-equal.svg',
  constraintHorizontal: 'sketch-horizontal.svg',
  constraintVertical: 'sketch-vertical.svg',
  constraintConcentric: 'sketch-concentric.svg',
  constraintMidpoint: 'sketch-midpoint.svg',
  constraintNormal: 'sketch-normal.svg',
  constraintPierce: 'sketch-pierce.svg',
  constraintSymmetric: 'sketch-symmetric.svg',
  constraintFix: 'sketch-fix.svg',
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
  sketchFillet: 'sketch-fillet.svg',
  sketchChamfer: 'sketch-chamfer.svg',
  sketchExtend: 'sketch-extend.svg',
  sketchSplit: 'sketch_split_icon.svg',
  sketchSlot: 'sketch-slot.svg',
  finishSketch: 'check_mark.svg',
  import: 'import-part.svg',
  search: 'search.svg',
  plane: 'c-plane.svg',
  combine: 'boolean-bodies.svg',
  history: 'change-history.svg',
  svgRendering: 'eye_open.svg',
  svgFill: 'svg-fill.svg',
  svgStroke: 'svg-stroke.svg',
  svgStrokeCap: 'svg-stroke-cap.svg',
  svgStrokeJoin: 'svg-stroke-join.svg',
  svgGradient: 'svg-gradient.svg',
}

export function getToolIconAssetFileName(icon: ToolIconId) {
  return toolIconAssetFileNames[icon]
}

export function getToolIconSrc(icon: ToolIconId) {
  const fileName = getToolIconAssetFileName(icon)
  const globalAssets = globalThis as typeof globalThis & {
    __CADARA_SINGLE_ASSETS__?: SingleFileAssets
  }

  return globalAssets.__CADARA_SINGLE_ASSETS__?.icons?.[fileName] ?? `/icons/${fileName}`
}
