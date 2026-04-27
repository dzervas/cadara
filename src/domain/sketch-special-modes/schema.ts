import type { RequestId, SketchAuthoringOperationId } from '@/contracts/shared/ids'
import type { SketchOperationRef } from '@/contracts/shared/references'
import type { SketchPoint } from '@/contracts/modeling/schema'
import type { PrimitiveRef, SelectionTargetCatalog } from '@/domain/editor/schema'
import type { SketchToolAnchorDescriptor } from '@/domain/sketch-tools/editor-schema'
import type { SketchSessionState } from '@/domain/editor/sketch-session'

export type SketchSpecialModeId = string
export type SketchSpecialModeTargetId = `sketch_special_target_${string}`
export type SketchSpecialModeHandleId = `sketch_special_handle_${string}`
export type SketchSpecialModeControlValue = string | number | boolean | null

export interface SketchSpecialModeTargetRef {
  kind: 'sketchSpecialTarget'
  operationId: SketchAuthoringOperationId
  targetId: SketchSpecialModeTargetId
}

export interface SketchSpecialModeHandleRef {
  kind: 'sketchSpecialHandle'
  operationId: SketchAuthoringOperationId
  handleId: SketchSpecialModeHandleId
}

export interface SketchSpecialModeEffectRequest {
  effectId: string
  kind: string
  payload: Record<string, unknown>
}

export interface SketchSpecialModePendingEffect {
  requestId: RequestId
  generation: number
  effect: SketchSpecialModeEffectRequest
}

export interface ActiveSketchSpecialModeSession<TState = unknown> {
  modeId: SketchSpecialModeId
  operationTarget: SketchOperationRef
  state: TState
  generation: number
  hoverTarget: SketchSpecialModeTargetRef | null
  selectedTarget: SketchSpecialModeTargetRef | null
  activeDragHandle: SketchSpecialModeHandleRef | null
  pendingEffect: SketchSpecialModePendingEffect | null
  pendingExit: boolean
}

export type SketchSpecialModePanelAction =
  | {
      kind: 'patch'
      patch: Record<string, SketchSpecialModeControlValue>
    }
  | {
      kind: 'command'
      command: 'commit' | 'cancel' | 'exit'
    }
  | {
      kind: 'invoke'
      actionId: string
      value?: SketchSpecialModeControlValue
    }

export type SketchSpecialModePanelField =
  | {
      id: string
      kind: 'text'
      label: string
      value: string
      placeholder?: string
      helper?: string
      disabled?: boolean
      error?: string
      action: Extract<SketchSpecialModePanelAction, { kind: 'patch' }>
    }
  | {
      id: string
      kind: 'numeric'
      label: string
      value: number | null
      unit?: string
      helper?: string
      disabled?: boolean
      error?: string
      action: Extract<SketchSpecialModePanelAction, { kind: 'patch' }>
    }
  | {
      id: string
      kind: 'toggle'
      label: string
      value: boolean
      helper?: string
      disabled?: boolean
      action: Extract<SketchSpecialModePanelAction, { kind: 'patch' }>
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
      helper?: string
      disabled?: boolean
      error?: string
      action: Extract<SketchSpecialModePanelAction, { kind: 'patch' }>
    }
  | {
      id: string
      kind: 'readout'
      label: string
      value: string
      tone?: 'neutral' | 'success' | 'warning'
      helper?: string
    }

export interface SketchSpecialModePanelButton {
  id: string
  label: string
  tone?: 'default' | 'primary' | 'danger'
  disabled?: boolean
  action: Exclude<SketchSpecialModePanelAction, { kind: 'patch' }>
}

export interface SketchSpecialModePanelDiagnostic {
  id: string
  message: string
  severity: 'info' | 'warning' | 'error'
}

export interface SketchSpecialModePanelSection {
  id: string
  title: string
  description?: string
  fields?: readonly SketchSpecialModePanelField[]
  diagnostics?: readonly SketchSpecialModePanelDiagnostic[]
  buttons?: readonly SketchSpecialModePanelButton[]
}

export interface SketchSpecialModePanelSchema {
  title: string
  subtitle?: string
  prompts?: readonly {
    id: string
    text: string
    tone?: 'neutral' | 'success' | 'warning'
  }[]
  sections: readonly SketchSpecialModePanelSection[]
  footerButtons?: readonly SketchSpecialModePanelButton[]
}

export type SketchSpecialModeViewportOverlay =
  | {
      id: string
      kind: 'badge'
      label: string
      anchor: SketchToolAnchorDescriptor
      tone?: 'neutral' | 'success' | 'warning'
    }
  | {
      id: string
      kind: 'diagnostic'
      message: string
      severity: 'info' | 'warning' | 'error'
      anchor: SketchToolAnchorDescriptor
    }
  | {
      id: string
      kind: 'segment'
      start: SketchPoint
      end: SketchPoint
      tone?: 'neutral' | 'success' | 'warning'
      dashed?: boolean
    }
  | {
      id: string
      kind: 'handle'
      label: string
      anchor: SketchToolAnchorDescriptor
      handle: SketchSpecialModeHandleRef
      tone?: 'neutral' | 'success' | 'warning'
      draggable?: boolean
    }

export interface SketchSpecialModeViewportPresentation {
  prompts?: readonly {
    id: string
    text: string
    tone?: 'neutral' | 'success' | 'warning'
  }[]
  diagnostics?: readonly SketchSpecialModePanelDiagnostic[]
  overlays?: readonly SketchSpecialModeViewportOverlay[]
}

export interface SketchSpecialModeLifecycleContext<TState = unknown> {
  sketchSession: SketchSessionState
  activeMode: ActiveSketchSpecialModeSession<TState>
}

export interface SketchSpecialModeSelectionContext<TState = unknown>
  extends SketchSpecialModeLifecycleContext<TState> {
  target: PrimitiveRef
  selection: readonly PrimitiveRef[]
  selectionCatalog: SelectionTargetCatalog | null
}

export interface SketchSpecialModeSelectionContract<TState = unknown> {
  label?: string
  description?: string
  allowedKinds?: readonly PrimitiveRef['kind'][]
  resolveTarget?(input: SketchSpecialModeSelectionContext<TState>): SketchSpecialModeTargetRef | null
  acceptsTarget?(input: SketchSpecialModeSelectionContext<TState>): boolean
}

export interface SketchSpecialModePointerContext<TState = unknown>
  extends SketchSpecialModeLifecycleContext<TState> {
  point: SketchPoint
  target: PrimitiveRef | null
  resolvedTarget: SketchSpecialModeTargetRef | null
}

export interface SketchSpecialModeHoverContext<TState = unknown>
  extends SketchSpecialModeLifecycleContext<TState> {
  target: PrimitiveRef | null
  resolvedTarget: SketchSpecialModeTargetRef | null
}

export interface SketchSpecialModePanelActionContext<TState = unknown>
  extends SketchSpecialModeLifecycleContext<TState> {
  action: SketchSpecialModePanelAction
}

export interface SketchSpecialModeHandleDragContext<TState = unknown>
  extends SketchSpecialModeLifecycleContext<TState> {
  handle: SketchSpecialModeHandleRef
  point: SketchPoint
}

export interface SketchSpecialModeEffectContext<TState = unknown>
  extends SketchSpecialModeLifecycleContext<TState> {
  effectId: string
  payload: Record<string, unknown>
}

export interface SketchSpecialModeOpenContext {
  sketchSession: SketchSessionState
  point: SketchPoint
  target: PrimitiveRef | null
  selection: readonly PrimitiveRef[]
  selectionCatalog: SelectionTargetCatalog | null
}

export interface SketchSpecialModeOpenRequest {
  operationId: SketchAuthoringOperationId
  payload?: Record<string, unknown>
}

export interface SketchSpecialModeOperationOwnedStateOverride {
  operationId: SketchAuthoringOperationId
  state: unknown
  label?: string
}

export interface SketchSpecialModeTransition<TState = unknown> {
  session?: SketchSessionState
  state?: TState
  hoverTarget?: SketchSpecialModeTargetRef | null
  selectedTarget?: SketchSpecialModeTargetRef | null
  activeDragHandle?: SketchSpecialModeHandleRef | null
  exit?: boolean
  effect?: SketchSpecialModeEffectRequest | null
}

export interface SketchSpecialModeDefinition<TState = unknown> {
  id: SketchSpecialModeId
  label: string
  resolveOpenRequest?(input: SketchSpecialModeOpenContext): SketchSpecialModeOpenRequest | null
  enter(input: {
    sketchSession: SketchSessionState
    operationTarget: SketchOperationRef
    payload?: Record<string, unknown>
  }): {
      state: TState
      effect?: SketchSpecialModeEffectRequest | null
  }
  selection?: SketchSpecialModeSelectionContract<TState>
  buildPanel?(input: SketchSpecialModeLifecycleContext<TState>): SketchSpecialModePanelSchema | null
  buildViewport?(input: SketchSpecialModeLifecycleContext<TState>): SketchSpecialModeViewportPresentation | null
  handleHover?(input: SketchSpecialModeHoverContext<TState>): SketchSpecialModeTransition<TState>
  handleClick?(input: SketchSpecialModePointerContext<TState>): SketchSpecialModeTransition<TState>
  handleDoubleClick?(input: SketchSpecialModePointerContext<TState>): SketchSpecialModeTransition<TState>
  handleDragStart?(input: SketchSpecialModeHandleDragContext<TState>): SketchSpecialModeTransition<TState>
  handleDragMove?(input: SketchSpecialModeHandleDragContext<TState>): SketchSpecialModeTransition<TState>
  handleDragEnd?(input: SketchSpecialModeHandleDragContext<TState>): SketchSpecialModeTransition<TState>
  handlePanelAction?(input: SketchSpecialModePanelActionContext<TState>): SketchSpecialModeTransition<TState>
  commit?(input: SketchSpecialModeLifecycleContext<TState>): SketchSpecialModeTransition<TState>
  cancel?(input: SketchSpecialModeLifecycleContext<TState>): SketchSpecialModeTransition<TState>
  handleEffectResult?(input: SketchSpecialModeEffectContext<TState>): SketchSpecialModeTransition<TState>
  getOperationOwnedStateOverride?(
    input: SketchSpecialModeLifecycleContext<TState>,
  ): SketchSpecialModeOperationOwnedStateOverride | null
}
