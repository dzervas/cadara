import type { ToolIconId, ToolbarMode } from '@/domain/tools/schema'

export type SketchEditToolId =
  | 'trim'
  | 'offset'
  | 'sketchFillet'
  | 'sketchChamfer'
  | 'sketchExtend'
  | 'sketchSplit'
  | 'sketchSlot'
  | 'sketchMirror'
  | 'sketchLinearPattern'
  | 'sketchCircularPattern'
  | 'sketchTransform'

export type SketchEditMutationContract =
  | 'trimAtIntersections'
  | 'createOffsetGeometry'
  | 'replaceCornerWithFilletArc'
  | 'replaceCornerWithChamferLine'
  | 'extendCurveToBoundary'
  | 'splitCurveAtBoundary'
  | 'createSlotBoundary'
  | 'createDerivedMirror'
  | 'createDerivedLinearPattern'
  | 'createDerivedCircularPattern'
  | 'createDerivedTransform'

export interface SketchEditToolSelectionRequirement {
  label: string
  acceptedKinds: readonly ('point' | 'line' | 'circle' | 'arc' | 'spline')[]
  requiredCount: number
  allowsMultiple?: boolean
}

export interface SketchEditToolMetadata<TToolId extends SketchEditToolId = SketchEditToolId> {
  id: TToolId
  name: string
  tooltip: string
  icon: ToolIconId
  group: 'sketchOps'
  modes: readonly ToolbarMode[]
  selection: SketchEditToolSelectionRequirement
  previewLabel: string
  validationMessages: {
    emptySelection: string
    unsupportedTarget: string
  }
  mutationContract: SketchEditMutationContract
}

export interface SketchEditToolDefinition<TToolId extends SketchEditToolId = SketchEditToolId> {
  metadata: SketchEditToolMetadata<TToolId>
}
