import type {
  SketchFillMode,
  SketchStrokeCap,
  SketchStrokeJoin,
  SketchStyleDefinition,
} from '@/contracts/sketch/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import type {
  SketchToolControlDescriptor,
  SketchToolPresentationSchema,
} from '@/domain/sketch-tools/editor-schema'
import type { ToolId } from '@/domain/tools/tool-registry'

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
  | 'strokeMiterLimit'
  | 'strokeDashSize'
  | 'strokeGapSize'

export type SketchStylePatch =
  | { intent: typeof SKETCH_STYLE_PATCH_INTENT; field: 'fillMode'; value: SketchFillMode }
  | { intent: typeof SKETCH_STYLE_PATCH_INTENT; field: 'fillColor'; value: string }
  | { intent: typeof SKETCH_STYLE_PATCH_INTENT; field: 'gradientStartColor'; value: string }
  | { intent: typeof SKETCH_STYLE_PATCH_INTENT; field: 'gradientEndColor'; value: string }
  | { intent: typeof SKETCH_STYLE_PATCH_INTENT; field: 'strokeEnabled'; value: boolean }
  | { intent: typeof SKETCH_STYLE_PATCH_INTENT; field: 'strokeColor'; value: string }
  | { intent: typeof SKETCH_STYLE_PATCH_INTENT; field: 'strokeWidth'; value: number }
  | { intent: typeof SKETCH_STYLE_PATCH_INTENT; field: 'strokeCap'; value: SketchStrokeCap }
  | { intent: typeof SKETCH_STYLE_PATCH_INTENT; field: 'strokeJoin'; value: SketchStrokeJoin }
  | { intent: typeof SKETCH_STYLE_PATCH_INTENT; field: 'strokeMiterLimit'; value: number }
  | { intent: typeof SKETCH_STYLE_PATCH_INTENT; field: 'strokeDashSize'; value: number }
  | { intent: typeof SKETCH_STYLE_PATCH_INTENT; field: 'strokeGapSize'; value: number }

export type SketchStyleToolId = Extract<
  ToolId,
  | 'fill'
  | 'stroke'
>

export interface SketchStyleFocus {
  toolId: SketchStyleToolId
  target: Extract<PrimitiveRef, { kind: 'region' | 'sketchEntity' }> | null
}

interface SketchStyleFocusDefinition {
  label: string
  controlIds: readonly string[]
}

export function buildSketchStyleControls(style: SketchStyleDefinition | undefined): readonly SketchToolControlDescriptor[] {
  const resolved: Required<SketchStyleDefinition> = {
    fillMode: style?.fillMode ?? 'none',
    fillColor: style?.fillColor ?? 'var(--cad-accent)',
    gradientStartColor: style?.gradientStartColor ?? 'var(--cad-accent)',
    gradientEndColor: style?.gradientEndColor ?? 'var(--cad-surface)',
    strokeEnabled: style?.strokeEnabled ?? false,
    strokeColor: style?.strokeColor ?? 'var(--cad-foreground)',
    strokeWidth: style?.strokeWidth ?? 1,
    strokeCap: style?.strokeCap ?? 'round',
    strokeJoin: style?.strokeJoin ?? 'round',
    strokeMiterLimit: style?.strokeMiterLimit ?? 4,
    strokeDashSize: style?.strokeDashSize ?? 0,
    strokeGapSize: style?.strokeGapSize ?? 0,
  }

  const fillEnabled = resolved.fillMode !== 'none'
  const gradientEnabled = resolved.fillMode === 'gradient'
  const strokeEnabled = resolved.strokeEnabled

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
    {
      id: 'sketch-style-stroke-miter-limit',
      kind: 'numeric',
      label: 'Miter Limit',
      value: resolved.strokeMiterLimit,
      disabled: !strokeEnabled || resolved.strokeJoin !== 'miter',
      action: { type: 'patch', patch: { intent: SKETCH_STYLE_PATCH_INTENT, field: 'strokeMiterLimit' } },
    },
    {
      id: 'sketch-style-stroke-dash-size',
      kind: 'numeric',
      label: 'Dash Size',
      value: resolved.strokeDashSize,
      disabled: !strokeEnabled,
      unit: 'px',
      action: { type: 'patch', patch: { intent: SKETCH_STYLE_PATCH_INTENT, field: 'strokeDashSize' } },
    },
    {
      id: 'sketch-style-stroke-gap-size',
      kind: 'numeric',
      label: 'Gap Size',
      value: resolved.strokeGapSize,
      disabled: !strokeEnabled,
      unit: 'px',
      action: { type: 'patch', patch: { intent: SKETCH_STYLE_PATCH_INTENT, field: 'strokeGapSize' } },
    },
  ]
}

export function isSketchStyleTarget(
  target: PrimitiveRef,
  sketchId: string,
  toolId: SketchStyleToolId,
): target is Extract<PrimitiveRef, { kind: 'region' | 'sketchEntity' }> {
  if (target.kind !== 'region' && target.kind !== 'sketchEntity') {
    return false
  }

  if (target.sketchId !== sketchId) {
    return false
  }

  return toolId === 'fill'
    ? target.kind === 'region'
    : target.kind === 'sketchEntity'
}

export function isSketchStyleToolId(toolId: ToolId): toolId is SketchStyleToolId {
  return toolId === 'fill'
    || toolId === 'stroke'
}

export function buildSketchStylePresentation(
  focus: SketchStyleFocus,
  style: SketchStyleDefinition | undefined,
): SketchToolPresentationSchema {
  const definition = getSketchStyleFocusDefinition(focus.toolId)

  if (!focus.target) {
    const isFill = focus.toolId === 'fill'

    return {
      prompts: [{ id: 'sketch-style-target-prompt', text: `${definition.label}: ${isFill ? 'select an enclosed region' : 'select a sketch edge'}` }],
      selectionGuide: {
        id: 'sketch-style-target-guide',
        label: isFill ? 'Select an enclosed region' : 'Select a sketch edge',
        acceptedKinds: isFill ? ['region'] : ['line', 'circle', 'arc', 'spline'],
        selectedCount: 0,
        requiredCount: 1,
      },
      controls: [],
      controlGroups: [],
      extension: {
        id: 'sketch-style-focus',
        payload: {
          toolId: focus.toolId,
          hasTarget: false,
        },
      },
    }
  }

  const controls = buildSketchStyleControls(style).filter((control) => definition.controlIds.includes(control.id))

  return {
    prompts: [{ id: 'sketch-style-prompt', text: definition.label }],
    controls,
    controlGroups: [{
      id: `sketch-style-${focus.toolId}-controls`,
      label: definition.label,
      controls,
    }],
    extension: {
      id: 'sketch-style-focus',
      payload: {
        toolId: focus.toolId,
        hasTarget: true,
        targetKind: focus.target.kind,
      },
    },
  }
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
    case 'strokeMiterLimit':
    case 'strokeDashSize':
    case 'strokeGapSize':
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
    || field === 'strokeMiterLimit'
    || field === 'strokeDashSize'
    || field === 'strokeGapSize'
}

function getSketchStyleFocusDefinition(toolId: SketchStyleToolId): SketchStyleFocusDefinition {
  switch (toolId) {
    case 'fill':
      return {
        label: 'Fill',
        controlIds: [
          'sketch-style-fill-mode',
          'sketch-style-fill-color',
          'sketch-style-gradient-start',
          'sketch-style-gradient-end',
        ],
      }
    case 'stroke':
      return {
        label: 'Stroke',
        controlIds: [
          'sketch-style-stroke-enabled',
          'sketch-style-stroke-color',
          'sketch-style-stroke-width',
          'sketch-style-stroke-cap',
          'sketch-style-stroke-join',
          'sketch-style-stroke-miter-limit',
          'sketch-style-stroke-dash-size',
          'sketch-style-stroke-gap-size',
        ],
      }
  }
}
