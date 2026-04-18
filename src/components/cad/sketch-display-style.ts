import * as THREE from 'three'

import type { SketchSessionDisplayRenderable } from '@/domain/editor/sketch-session'
import { SURFACE_COLORS } from '@/domain/workspace/render-picking'
import type { ToolbarMode } from '@/domain/tools/schema'

export interface SketchDisplayMeshMaterialConfig {
  color: number
  transparent: boolean
  opacity: number
  side: THREE.Side
  metalness: number
  roughness: number
  emissive: number
  emissiveIntensity: number
}

export interface SketchDisplayPolylineMaterialConfig {
  linePattern: SketchSessionDisplayRenderable['linePattern']
  color: number
  opacity: number
  lineWidth: number
  dashSize: number
  gapSize: number
}

export function shouldApplySketchDisplayStyles(mode: ToolbarMode, hasSketchSession: boolean) {
  return mode === 'sketch' && hasSketchSession
}

export function getSketchDisplayMeshMaterialConfig(
  renderable: SketchSessionDisplayRenderable,
  applyStyles: boolean,
): SketchDisplayMeshMaterialConfig {
  const defaultColor = renderable.role === 'reference' ? SURFACE_COLORS.sketchReference : SURFACE_COLORS.sketchCurve
  const defaultOpacity = 0.24
  const color = applyStyles ? renderable.paintStyle?.color ?? defaultColor : defaultColor
  const opacity = applyStyles ? renderable.paintStyle?.opacity ?? defaultOpacity : defaultOpacity

  return {
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    metalness: 0.08,
    roughness: 0.58,
    emissive: renderable.role === 'reference' ? 0x4a3511 : 0x214566,
    emissiveIntensity: renderable.role === 'reference' ? 0.2 : 0.18,
  }
}

export function getSketchDisplayPolylineMaterialConfig(
  renderable: SketchSessionDisplayRenderable,
  applyStyles: boolean,
): SketchDisplayPolylineMaterialConfig {
  const defaultColor = renderable.role === 'reference' ? 0xf0c56c : SURFACE_COLORS.sketchCurve
  const linePattern = renderable.linePattern
  const defaultOpacity = linePattern === 'dashed'
    ? (renderable.role === 'reference' ? 0.7 : 0.88)
    : 0.95

  return {
    linePattern,
    color: applyStyles ? renderable.strokeStyle?.color ?? defaultColor : defaultColor,
    opacity: applyStyles ? renderable.strokeStyle?.opacity ?? defaultOpacity : defaultOpacity,
    lineWidth: applyStyles ? renderable.strokeStyle?.width ?? 1 : 1,
    dashSize: applyStyles ? renderable.strokeStyle?.dashSize ?? 0.24 : 0.24,
    gapSize: applyStyles ? renderable.strokeStyle?.gapSize ?? 0.14 : 0.14,
  }
}
