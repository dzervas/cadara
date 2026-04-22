import * as THREE from 'three'

import type { SketchSessionDisplayRenderable } from '@/domain/editor/sketch-session'
import { SURFACE_COLORS } from '@/domain/workspace/render-picking'
import type { ToolbarMode } from '@/domain/tools/schema'
import type { SketchRenderingPalette } from '@/components/cad/sketch-rendering-palette'

export interface SketchDisplayMeshMaterialConfig {
  color: number
  transparent: boolean
  opacity: number
  side: THREE.Side
  polygonOffset: boolean
  polygonOffsetFactor: number
  polygonOffsetUnits: number
}

export interface SketchDisplayPolylineMaterialConfig {
  linePattern: SketchSessionDisplayRenderable['linePattern']
  color: number
  opacity: number
  lineWidth: number
  lineCap: 'butt' | 'round' | 'square'
  lineJoin: 'miter' | 'round' | 'bevel'
  miterLimit: number
  dashSize: number
  gapSize: number
}

export interface SketchDisplayMarkerMaterialConfig {
  color: number
  transparent: boolean
  opacity: number
}

export function shouldApplySketchDisplayStyles(mode: ToolbarMode, hasSketchSession: boolean) {
  return mode === 'sketch' && hasSketchSession
}

export function getSketchDisplayMeshMaterialConfig(
  renderable: SketchSessionDisplayRenderable,
  applyStyles: boolean,
  palette: SketchRenderingPalette,
): SketchDisplayMeshMaterialConfig {
  const defaultColor = renderable.semanticClass === 'region'
    ? palette.regionFill
    : renderable.role === 'reference' ? SURFACE_COLORS.sketchReference : getDefaultSketchConstraintColor(renderable, palette)
  const defaultOpacity = renderable.semanticClass === 'region' ? 0.22 : 0.24
  const color = applyStyles ? renderable.paintStyle?.color ?? defaultColor : defaultColor
  const opacity = applyStyles ? renderable.paintStyle?.opacity ?? defaultOpacity : defaultOpacity

  return {
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    polygonOffset: renderable.semanticClass === 'region',
    polygonOffsetFactor: renderable.semanticClass === 'region' ? -2 : 0,
    polygonOffsetUnits: renderable.semanticClass === 'region' ? -2 : 0,
  }
}

export function getSketchDisplayPolylineMaterialConfig(
  renderable: SketchSessionDisplayRenderable,
  applyStyles: boolean,
  palette: SketchRenderingPalette,
): SketchDisplayPolylineMaterialConfig {
  const isDiagnostic = renderable.diagnosticStyle?.kind === 'overconstraint'
  const defaultColor = renderable.role === 'reference'
    ? SURFACE_COLORS.sketchReference
    : isDiagnostic
      ? palette.overconstrained
      : getDefaultSketchConstraintColor(renderable, palette)
  const hasAuthoredDash = applyStyles
    && (renderable.strokeStyle?.dashSize ?? 0) > 0
    && (renderable.strokeStyle?.gapSize ?? 0) > 0
  const linePattern = isDiagnostic ? 'solid' : hasAuthoredDash ? 'dashed' : renderable.linePattern
  const defaultOpacity = linePattern === 'dashed'
    ? (renderable.role === 'reference' ? 0.7 : 0.88)
    : 0.95

  return {
    linePattern,
    color: isDiagnostic ? defaultColor : applyStyles ? renderable.strokeStyle?.color ?? defaultColor : defaultColor,
    opacity: isDiagnostic ? 1 : applyStyles ? renderable.strokeStyle?.opacity ?? defaultOpacity : defaultOpacity,
    lineWidth: isDiagnostic ? 1 : applyStyles ? renderable.strokeStyle?.width ?? 1 : 1,
    lineCap: isDiagnostic ? 'round' : applyStyles ? renderable.strokeStyle?.lineCap ?? 'round' : 'round',
    lineJoin: isDiagnostic ? 'round' : applyStyles ? renderable.strokeStyle?.lineJoin ?? 'round' : 'round',
    miterLimit: isDiagnostic ? 4 : applyStyles ? renderable.strokeStyle?.miterLimit ?? 4 : 4,
    dashSize: isDiagnostic ? 0.24 : applyStyles ? renderable.strokeStyle?.dashSize ?? 0.24 : 0.24,
    gapSize: isDiagnostic ? 0.14 : applyStyles ? renderable.strokeStyle?.gapSize ?? 0.14 : 0.14,
  }
}

export function getSketchDisplayMarkerMaterialConfig(
  renderable: SketchSessionDisplayRenderable,
  applyStyles: boolean,
  palette: SketchRenderingPalette,
): SketchDisplayMarkerMaterialConfig {
  const defaultColor = renderable.role === 'reference'
    ? SURFACE_COLORS.sketchReference
    : renderable.constraintDisplay?.isAffectedOverconstraint
      ? palette.overconstrained
      : getDefaultSketchConstraintColor(renderable, palette)

  return {
    color: applyStyles
      ? renderable.paintStyle?.color ?? renderable.strokeStyle?.color ?? defaultColor
      : defaultColor,
    transparent: applyStyles && (
      renderable.paintStyle?.opacity !== undefined || renderable.strokeStyle?.opacity !== undefined
    ),
    opacity: applyStyles ? renderable.paintStyle?.opacity ?? renderable.strokeStyle?.opacity ?? 1 : 1,
  }
}

function getDefaultSketchConstraintColor(
  renderable: SketchSessionDisplayRenderable,
  palette: SketchRenderingPalette,
) {
  switch (renderable.constraintDisplay?.state) {
    case 'constrained':
      return palette.constrained
    case 'overconstrained':
      return renderable.constraintDisplay.isAffectedOverconstraint
        ? palette.underconstrained
        : palette.underconstrained
    case 'underconstrained':
    case undefined:
      return palette.underconstrained
  }
}
