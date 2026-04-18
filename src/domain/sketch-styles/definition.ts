import type { SketchStyleDefinition } from '@/contracts/sketch/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import type { SketchToolControlDescriptor } from '@/domain/sketch-tools/editor-schema'

export const SKETCH_STYLE_PATCH_INTENT = 'patchSketchStyle' as const

export type SketchStylePatchField =
  | 'fillMode'
  | 'fillColor'
  | 'gradientStartColor'
  | 'gradientEndColor'
  | 'strokeEnabled'
  | 'strokeColor'
  | 'strokeWidth'
  | 'strokeCap'
  | 'strokeJoin'

export type SketchStylePatch = {
  intent: typeof SKETCH_STYLE_PATCH_INTENT
  field: SketchStylePatchField
  value: string | number | boolean | null
}

export function buildSketchStyleControls(style: SketchStyleDefinition | undefined): readonly SketchToolControlDescriptor[] {
  const resolved: SketchStyleDefinition = {
    fillMode: style?.fillMode ?? 'none',
    fillColor: style?.fillColor ?? 'var(--cad-accent)',
    gradientStartColor: style?.gradientStartColor ?? 'var(--cad-accent)',
    gradientEndColor: style?.gradientEndColor ?? 'var(--cad-surface)',
    strokeEnabled: style?.strokeEnabled ?? true,
    strokeColor: style?.strokeColor ?? 'var(--cad-foreground)',
    strokeWidth: style?.strokeWidth ?? 1,
    strokeCap: style?.strokeCap ?? 'round',
    strokeJoin: style?.strokeJoin ?? 'round',
  }

  const fillEnabled = resolved.fillMode !== 'none'
  const gradientEnabled = resolved.fillMode === 'gradient'
  const strokeEnabled = resolved.strokeEnabled !== false

  return [
    {
      id: 'sketch-style-fill-mode',
      kind: 'option',
      label: 'Fill Mode',
      value: resolved.fillMode,
      options: [
        { value: 'none', label: 'None' },
        { value: 'solid', label: 'Solid' },
        { value: 'gradient', label: 'Gradient' },
      ],
      action: { type: 'patch', patch: { intent: SKETCH_STYLE_PATCH_INTENT, field: 'fillMode' } },
    },
    {
      id: 'sketch-style-fill-color',
      kind: 'color',
      label: gradientEnabled ? 'Fill Color (fallback)' : 'Fill Color',
      value: resolved.fillColor,
      disabled: !fillEnabled,
      action: { type: 'patch', patch: { intent: SKETCH_STYLE_PATCH_INTENT, field: 'fillColor' } },
    },
    {
      id: 'sketch-style-gradient-start',
      kind: 'color',
      label: 'Gradient Start',
      value: resolved.gradientStartColor,
      disabled: !gradientEnabled,
      action: { type: 'patch', patch: { intent: SKETCH_STYLE_PATCH_INTENT, field: 'gradientStartColor' } },
    },
    {
      id: 'sketch-style-gradient-end',
      kind: 'color',
      label: 'Gradient End',
      value: resolved.gradientEndColor,
      disabled: !gradientEnabled,
      action: { type: 'patch', patch: { intent: SKETCH_STYLE_PATCH_INTENT, field: 'gradientEndColor' } },
    },
    {
      id: 'sketch-style-stroke-enabled',
      kind: 'toggle',
      label: 'Stroke Enabled',
      value: strokeEnabled,
      action: { type: 'patch', patch: { intent: SKETCH_STYLE_PATCH_INTENT, field: 'strokeEnabled' } },
    },
    {
      id: 'sketch-style-stroke-color',
      kind: 'color',
      label: 'Stroke Color',
      value: resolved.strokeColor,
      disabled: !strokeEnabled,
      action: { type: 'patch', patch: { intent: SKETCH_STYLE_PATCH_INTENT, field: 'strokeColor' } },
    },
    {
      id: 'sketch-style-stroke-width',
      kind: 'numeric',
      label: 'Stroke Width',
      value: resolved.strokeWidth,
      disabled: !strokeEnabled,
      unit: 'px',
      action: { type: 'patch', patch: { intent: SKETCH_STYLE_PATCH_INTENT, field: 'strokeWidth' } },
    },
    {
      id: 'sketch-style-stroke-cap',
      kind: 'option',
      label: 'Stroke Cap',
      value: resolved.strokeCap,
      disabled: !strokeEnabled,
      options: [
        { value: 'butt', label: 'Butt' },
        { value: 'round', label: 'Round' },
        { value: 'square', label: 'Square' },
      ],
      action: { type: 'patch', patch: { intent: SKETCH_STYLE_PATCH_INTENT, field: 'strokeCap' } },
    },
    {
      id: 'sketch-style-stroke-join',
      kind: 'option',
      label: 'Stroke Join',
      value: resolved.strokeJoin,
      disabled: !strokeEnabled,
      options: [
        { value: 'miter', label: 'Miter' },
        { value: 'round', label: 'Round' },
        { value: 'bevel', label: 'Bevel' },
      ],
      action: { type: 'patch', patch: { intent: SKETCH_STYLE_PATCH_INTENT, field: 'strokeJoin' } },
    },
  ]
}

export function isSketchStyleTarget(target: PrimitiveRef, sketchId: string): target is Extract<PrimitiveRef, { kind: 'sketchEntity' | 'sketchPoint' }> {
  return (target.kind === 'sketchEntity' || target.kind === 'sketchPoint') && target.sketchId === sketchId
}

export function parseSketchStylePatch(patch: Record<string, unknown>): SketchStylePatch | null {
  if (patch.intent !== SKETCH_STYLE_PATCH_INTENT || typeof patch.field !== 'string') {
    return null
  }

  if (!isSketchStylePatchField(patch.field)) {
    return null
  }

  const value = patch.value

  switch (patch.field) {
    case 'fillMode':
      return value === 'none' || value === 'solid' || value === 'gradient'
        ? { intent: SKETCH_STYLE_PATCH_INTENT, field: patch.field, value }
        : null
    case 'fillColor':
    case 'gradientStartColor':
    case 'gradientEndColor':
    case 'strokeColor':
      return typeof value === 'string' ? { intent: SKETCH_STYLE_PATCH_INTENT, field: patch.field, value } : null
    case 'strokeEnabled':
      return typeof value === 'boolean' ? { intent: SKETCH_STYLE_PATCH_INTENT, field: patch.field, value } : null
    case 'strokeWidth':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? { intent: SKETCH_STYLE_PATCH_INTENT, field: patch.field, value }
        : null
    case 'strokeCap':
      return value === 'butt' || value === 'round' || value === 'square'
        ? { intent: SKETCH_STYLE_PATCH_INTENT, field: patch.field, value }
        : null
    case 'strokeJoin':
      return value === 'miter' || value === 'round' || value === 'bevel'
        ? { intent: SKETCH_STYLE_PATCH_INTENT, field: patch.field, value }
        : null
  }
}

function isSketchStylePatchField(field: string): field is SketchStylePatchField {
  return field === 'fillMode'
    || field === 'fillColor'
    || field === 'gradientStartColor'
    || field === 'gradientEndColor'
    || field === 'strokeEnabled'
    || field === 'strokeColor'
    || field === 'strokeWidth'
    || field === 'strokeCap'
    || field === 'strokeJoin'
}
