import type { SketchPoint } from '@/contracts/modeling/schema'
import type { Vec3 } from '@/domain/modeling/occ/math'

export type SketchToolControlValue = string | number | boolean | null

export interface SketchToolAnchorOffset {
  x: number
  y: number
}

export type SketchToolAnchorDescriptor =
  | {
      kind: 'sketchPoint'
      point: SketchPoint
      offset?: SketchToolAnchorOffset
    }
  | {
      kind: 'cursor'
      point: SketchPoint
      offset?: SketchToolAnchorOffset
    }
  | {
      kind: 'worldPoint'
      point: Vec3
      offset?: SketchToolAnchorOffset
    }

export interface SketchToolActionDescriptor {
  type: 'patch'
  patch: Record<string, SketchToolControlValue>
}

export interface SketchToolPromptDescriptor {
  id: string
  text: string
  tone?: 'neutral' | 'success' | 'warning'
}

export interface SketchToolStepDescriptor {
  id: string
  label: string
}

export interface SketchToolCursorDescriptor {
  id: string
  label: string
  icon?: 'crosshair' | 'constraint' | 'dimension'
}

export interface SketchToolSelectionGuideDescriptor {
  id: string
  label: string
  acceptedKinds: readonly ('point' | 'line' | 'circle' | 'arc' | 'annotation')[]
  selectedCount: number
  requiredCount: number
  hoverLabel?: string | null
}

export type SketchToolControlDescriptor =
  | {
      id: string
      kind: 'numeric'
      label: string
      value: number | null
      unit?: string
      disabled?: boolean
      action: SketchToolActionDescriptor
    }
  | {
      id: string
      kind: 'option'
      label: string
      value: string | null
      options: readonly {
        value: string
        label: string
      }[]
      disabled?: boolean
      action: SketchToolActionDescriptor
    }

export interface SketchToolMeasurementDescriptor {
  id: string
  label: string
  value: number
  unit?: string
}

export interface SketchToolCompletionHintDescriptor {
  id: string
  text: string
  ready: boolean
}

export type SketchToolOverlayDescriptor =
  | {
      id: string
      kind: 'measurement'
      label: string
      value: number
      unit?: string
      anchor: SketchToolAnchorDescriptor
    }
  | {
      id: string
      kind: 'constraintPreview'
      label: string
      detail: string
      anchor: SketchToolAnchorDescriptor
    }
  | {
      id: string
      kind: 'anchor'
      label: string
      point: SketchPoint
    }
  | {
      id: string
      kind: 'helperMarker'
      label: string
      point: SketchPoint
    }
  | {
      id: string
      kind: 'completionCue'
      label: string
      point: SketchPoint
      ready: boolean
    }

export interface SketchToolFloatingInputDescriptor {
  id: string
  label: string
  value: number | null
  unit?: string
  confirmLabel: string
  cancelLabel: string
  min?: number
  anchor?: SketchToolAnchorDescriptor
  submitAction: SketchToolActionDescriptor
  cancelAction: SketchToolActionDescriptor
}

export interface SketchToolValidationDescriptor {
  id: string
  message: string
  severity: 'info' | 'warning' | 'error'
}

export interface SketchToolPresentationSchema {
  prompts: readonly SketchToolPromptDescriptor[]
  steps?: readonly SketchToolStepDescriptor[]
  cursor?: SketchToolCursorDescriptor | null
  selectionGuide?: SketchToolSelectionGuideDescriptor | null
  controls?: readonly SketchToolControlDescriptor[]
  measurements?: readonly SketchToolMeasurementDescriptor[]
  completionHints?: readonly SketchToolCompletionHintDescriptor[]
  overlays?: readonly SketchToolOverlayDescriptor[]
  floatingInput?: SketchToolFloatingInputDescriptor | null
  validation?: readonly SketchToolValidationDescriptor[]
  extension?: {
    id: string
    payload: Record<string, unknown>
  }
}
