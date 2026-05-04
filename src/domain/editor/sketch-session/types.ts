import type {
  ConstraintId,
  DimensionId,
  RenderableId,
  SketchAuthoringOperationId,
  SketchEntityId,
  SketchId,
} from '@/contracts/shared/ids'
import type {
  SketchAuthoringOperation,
  SketchDefinition,
} from '@/contracts/sketch/schema'
import type {
  SketchConstraintRef,
  SketchDimensionRef,
  SketchEntityRef,
  SketchPointRef,
} from '@/contracts/shared/references'
import type { SketchPlaneDefinition, SketchPlaneSupportRef } from '@/contracts/shared/sketch-plane'
import type { SketchPlaneFrame } from '@/contracts/shared/sketch-plane'
import type {
  CommitSketchRequest,
  SketchPlaneKey,
  SketchPoint,
} from '@/contracts/modeling/schema'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { PrimitiveRef } from '@/core/editor/schema'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import type {
  SketchToolAnchorDescriptor,
  SketchToolControlValue,
  SketchToolPresentationSchema,
} from '@/core/sketch-tools/editor-schema'
import type { SketchSnapCandidate } from '@/domain/sketch-snapping/snap-candidates'
import type { SketchStyleFocus } from '@/domain/sketch-styles/definition'
import type { OffsetSide } from '@/domain/sketch-editing/operations'
import type { SketchEditToolId } from '@/core/sketch-edit-tools/definition'
import type { ActiveSketchSpecialModeSession } from '@/core/sketch-special-modes/schema'
import type { DimensionAnnotationPlacement, RegionRecord } from '@/contracts/sketch/schema'

export type { SketchDraftEntity, SketchToolId } from '@/core/sketch-tools/definition'
export type { SketchConstraintToolId } from '@/core/sketch-constraints/definition'

export type SketchConstructionToolId = 'construction'
export type SketchReferenceToolId = 'projectReference'
export type SketchAuthoringToolId =
  | import('@/core/sketch-tools/definition').SketchToolId
  | SketchEditToolId
  | import('@/core/sketch-constraints/definition').SketchConstraintToolId
  | SketchConstructionToolId
  | SketchReferenceToolId
export type SketchSessionStatus = 'idle' | 'drawing' | 'collectingTargets' | 'awaitingValue'

export interface SketchConstraintAuthoringState {
  toolId: import('@/core/sketch-constraints/definition').SketchConstraintToolId
  selectedTargets: import('@/core/sketch-constraints/definition').SketchConstraintTargetRecord[]
  hoverTarget: import('@/core/sketch-constraints/definition').SketchConstraintTargetRecord | null
  pointer: SketchPoint | null
  isPreviewPinned: boolean
  pendingValue: number | null
  pendingAnnotationPlacement: DimensionAnnotationPlacement | null
}

export interface SketchAnnotationEditState {
  target: SketchConstraintRef | SketchDimensionRef
  pendingValue: number | null
}

export interface SketchAnnotationDescriptor {
  id: string
  target: SketchConstraintRef | SketchDimensionRef
  glyphKind: SketchAnnotationGlyphKind
  anchor: SketchToolAnchorDescriptor
  affectedGeometryRefs: readonly PrimitiveRef[]
  constraintDisplay?: SketchConstraintDisplayTargetState
  label: string
  detail: string
  status: 'constraint' | 'dimension'
  visibleLabel?: string
  dragHandle?: SketchDimensionAnnotationDragHandle
}

export interface SketchDimensionAnnotationDragHandle {
  id: string
  dimensionId: DimensionId
}

export type SketchAnnotationGlyphKind =
  | 'constraintCoincident'
  | 'constraintParallel'
  | 'constraintEqual'
  | 'constraintHorizontal'
  | 'constraintVertical'
  | 'constraintFixed'
  | 'constraintAngle'
  | 'constraintPerpendicular'
  | 'constraintTangent'
  | 'constraintConcentric'
  | 'constraintMidpoint'
  | 'constraintNormal'
  | 'constraintPierce'
  | 'constraintSymmetric'
  | 'dimensionDistance'
  | 'dimensionHorizontal'
  | 'dimensionVertical'
  | 'dimensionRadius'
  | 'dimensionAngle'
  | 'dimensionCoincident'

export interface SketchGeometryDragState {
  target: SketchPointRef
  startPoint: SketchPoint
  currentPoint: SketchPoint
  status: 'dragging' | 'blocked'
  message: string | null
}

export interface SketchEditToolState {
  toolId: SketchEditToolId
  hoverTarget: PrimitiveRef | null
  selectedTarget: PrimitiveRef | null
  selectedTargets: PrimitiveRef[]
  offsetDistance: number | null
  offsetSide: OffsetSide
  toolValue: number | null
}

export interface SketchSessionState {
  sketchId: SketchId | null
  sketchLabel: string
  plane: SketchPlaneDefinition
  planeTarget: SketchPlaneSupportRef
  planeKey: SketchPlaneKey | null
  toolStagedEntities: readonly import('@/core/sketch-tools/definition').SketchDraftEntity[]
  definition: SketchDefinition
  fullDefinition: SketchDefinition
  historyCursor: SketchHistoryCursor
  historyOperations: SketchHistoryOperation[]
  activeTool: SketchAuthoringToolId | null
  status: SketchSessionStatus
  constructionTargetPicking: boolean
  referenceTargetPicking: boolean
  constructionModifierActive: boolean
  pointerDownPoint: SketchPoint | null
  livePoint: SketchPoint | null
  toolPlacedPoints: readonly SketchPoint[]
  toolSettings: Record<string, SketchToolControlValue>
  toolPresentation: SketchToolPresentationSchema | null
  constraintAuthoring: SketchConstraintAuthoringState | null
  activeAnnotationEdit: SketchAnnotationEditState | null
  selectedAnnotation: SketchConstraintRef | SketchDimensionRef | null
  activeEditTool: SketchEditToolState | null
  activeEditTarget: SketchPointRef | null
  activeStyleFocus: SketchStyleFocus | null
  activeSpecialMode: ActiveSketchSpecialModeSession | null
  activeDrag: SketchGeometryDragState | null
  activeSnap: SketchSnapCandidate | null
  drawStartSnap: SketchSnapCandidate | null
  sequence: number
  solvedRegions: RegionRecord[]
  projectedReferences: ProjectedSketchReferenceRecord[]
  projectionDiagnostics: ProjectedSketchReferenceRecord['diagnostics']
  commitRequest: Omit<CommitSketchRequest, 'contractVersion' | 'documentId' | 'baseRevisionId'> | null
  validationMessage: string | null
}

export interface SketchSessionDisplayRenderable {
  id: RenderableId
  label: string
  geometry: RenderableEntityRecord['geometry']
  target: PrimitiveRef | null
  linePattern: 'solid' | 'dashed'
  role: 'local' | 'reference'
  semanticClass?: RenderableEntityRecord['binding']['semanticClass'] | 'sketchReference' | 'sketchImage'
  markerLayer?: 'default' | 'overlay'
  paintStyle?: SketchDisplayPaintStyle
  strokeStyle?: SketchDisplayStrokeStyle
  constraintDisplay?: SketchConstraintDisplayTargetState
  diagnosticStyle?: SketchDisplayDiagnosticStyle
  sketchPlaneFrame?: SketchPlaneFrame
  textureFill?: {
    kind: 'inlineImage'
    sourceKey: string
    mediaType: string
    base64Data: string
    uvCoordinates: readonly [
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
    ]
    opacity: number
  }
}

export type SketchConstraintDisplayState = 'constrained' | 'underconstrained' | 'overconstrained'

export interface SketchConstraintDisplayTargetState {
  state: SketchConstraintDisplayState
  isAffectedOverconstraint: boolean
}

export interface SketchConstraintDisplaySummary {
  state: SketchConstraintDisplayState
  affectedTargetKeys: ReadonlySet<string>
}

export interface SketchDisplayDiagnosticStyle {
  kind: 'overconstraint'
}

export type SketchDisplayPaintStyle =
  | {
      kind?: 'solid'
      color: number
      opacity: number
    }
  | {
      kind: 'linearGradient'
      color: number
      opacity: number
      startColor: number
      startOpacity: number
      endColor: number
      endOpacity: number
      angleRadians: number
    }

export interface SketchDisplaySolidPaintStyle {
  color: number
  opacity: number
}

export interface SketchDisplayStrokeStyle {
  color: number
  opacity: number
  width?: number
  lineCap?: 'butt' | 'round' | 'square'
  lineJoin?: 'miter' | 'round' | 'bevel'
  miterLimit?: number
  dashSize?: number
  gapSize?: number
}

export type SketchHistoryCursor =
  | { kind: 'empty' }
  | { kind: 'item'; itemId: string }

export interface SketchHistoryOperation {
  itemId: string
  beforeCursor: SketchHistoryCursor
  beforeDefinition: SketchDefinition
  afterDefinition: SketchDefinition
}

export type SketchHistoryItem =
  | {
      kind: 'operation'
      id: SketchAuthoringOperationId
      label: string
      operation: SketchAuthoringOperation
      target: PrimitiveRef | null
    }
  | {
      kind: 'entity'
      id: SketchEntityId
      label: string
      target: SketchEntityRef
    }
  | {
      kind: 'constraint'
      id: ConstraintId
      label: string
      target: SketchConstraintRef
    }
  | {
      kind: 'dimension'
      id: DimensionId
      label: string
      target: SketchDimensionRef
    }
