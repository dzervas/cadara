import { DEFAULT_THEME } from '@mantine/core'
import * as THREE from 'three'

import { workbenchColors } from '@/theme/workbench-theme'

export type SketchRenderingPaletteRole =
  | 'constrained'
  | 'underconstrained'
  | 'overconstrained'
  | 'regionFill'

export type SketchRenderingPalette = Record<SketchRenderingPaletteRole, number>

export const SKETCH_RENDERING_PALETTE_TOKENS = {
  constrained: '--workbench-tooltip-description',
  underconstrained: '--mantine-color-blue-9',
  overconstrained: '--workbench-shell-danger-text',
  regionFill: '--workbench-shell-border',
} as const satisfies Record<SketchRenderingPaletteRole, string>

const MISSING_COLOR_SENTINEL = ['rgb', '(1, 2, 3)'].join('')

const SKETCH_RENDERING_PALETTE_FALLBACKS = {
  constrained: getColorHex(workbenchColors[2]),
  underconstrained: getColorHex(DEFAULT_THEME.colors.blue[9]!),
  overconstrained: getColorHex(DEFAULT_THEME.colors.red[2]!),
  regionFill: getColorHex(workbenchColors[5]),
} as const satisfies SketchRenderingPalette

export function getSketchRenderingPaletteToken(role: SketchRenderingPaletteRole) {
  return SKETCH_RENDERING_PALETTE_TOKENS[role]
}

export function resolveSketchRenderingPalette(
  readCssVariable: (token: string) => string = readDocumentCssVariable,
): SketchRenderingPalette {
  return {
    constrained: resolveCssVariableColor(
      SKETCH_RENDERING_PALETTE_TOKENS.constrained,
      readCssVariable,
      SKETCH_RENDERING_PALETTE_FALLBACKS.constrained,
    ),
    underconstrained: resolveCssVariableColor(
      SKETCH_RENDERING_PALETTE_TOKENS.underconstrained,
      readCssVariable,
      SKETCH_RENDERING_PALETTE_FALLBACKS.underconstrained,
    ),
    overconstrained: resolveCssVariableColor(
      SKETCH_RENDERING_PALETTE_TOKENS.overconstrained,
      readCssVariable,
      SKETCH_RENDERING_PALETTE_FALLBACKS.overconstrained,
    ),
    regionFill: resolveCssVariableColor(
      SKETCH_RENDERING_PALETTE_TOKENS.regionFill,
      readCssVariable,
      SKETCH_RENDERING_PALETTE_FALLBACKS.regionFill,
    ),
  }
}

function readDocumentCssVariable(token: string) {
  if (typeof document === 'undefined') {
    return ''
  }

  const directlyResolved = resolveDocumentCssVariable(token, new Set())
  return directlyResolved || resolveCssVariableThroughElement(token)
}

function resolveDocumentCssVariable(token: string, seen: Set<string>): string {
  if (seen.has(token)) {
    throw new Error(`Circular CSS variable reference while resolving ${token}.`)
  }
  seen.add(token)

  const rootValue = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const bodyValue = document.body ? getComputedStyle(document.body).getPropertyValue(token).trim() : ''
  const value = rootValue || bodyValue
  const reference = parseCssVariableReference(value)
  if (!reference) {
    return value
  }

  return resolveDocumentCssVariable(reference, seen)
}

function parseCssVariableReference(value: string) {
  const match = value.match(/^var\((--[a-zA-Z0-9-_]+)(?:,\s*.+)?\)$/)
  return match?.[1] ?? null
}

function resolveCssVariableThroughElement(token: string) {
  const host = document.body ?? document.documentElement
  const probe = document.createElement('span')
  probe.style.color = `var(${token}, ${MISSING_COLOR_SENTINEL})`
  probe.style.position = 'absolute'
  probe.style.pointerEvents = 'none'
  probe.style.visibility = 'hidden'
  host.append(probe)

  const color = getComputedStyle(probe).color.trim()
  probe.remove()
  return color === MISSING_COLOR_SENTINEL ? '' : color
}

function resolveCssVariableColor(
  token: string,
  readCssVariable: (token: string) => string,
  fallback: number,
) {
  const value = readCssVariable(token).trim()
  if (!value) {
    return fallback
  }

  return getColorHex(value)
}

function getColorHex(value: string) {
  const color = new THREE.Color()
  color.setStyle(value.trim())
  return color.getHex()
}
