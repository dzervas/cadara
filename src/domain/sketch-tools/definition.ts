import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
} from '@/contracts/sketch/schema'
import type { SketchEntityId, SketchPointId } from '@/contracts/shared/ids'
import type { SketchPoint } from '@/contracts/modeling/schema'
import type { ToolIconId, ToolbarMode } from '@/domain/tools/schema'
import type { SketchToolPresentationSchema } from '@/domain/sketch-tools/editor-schema'
import type { SketchSnapCandidate } from '@/domain/sketch-snapping/snap-candidates'

export type SketchToolId =
  | 'point'
  | 'line'
  | 'midpointLine'
  | 'rectangle'
  | 'centerPointRectangle'
  | 'alignedRectangle'
  | 'circle'
  | 'threePointCircle'
  | 'centerPointArc'
  | 'threePointArc'
  | 'tangentArc'
  | 'inscribedPolygon'
  | 'circumscribedPolygon'
  | 'spline'

export type SketchDraftEntity =
  | {
      id: string
      kind: 'line'
      start: SketchPoint
      end: SketchPoint
      entityId: SketchEntityId | null
      status: 'preview' | 'accepted'
      label: string
      isConstruction: boolean
    }
  | {
      id: string
      kind: 'circle'
      center: SketchPoint
      radius: number
      entityId: SketchEntityId | null
      status: 'preview' | 'accepted'
      label: string
      isConstruction: boolean
    }
  | {
      id: string
      kind: 'spline'
      points: readonly SketchPoint[]
      entityId: SketchEntityId | null
      status: 'preview' | 'accepted'
      label: string
      isConstruction: boolean
    }
  | {
      id: string
      kind: 'polyline'
      points: readonly SketchPoint[]
      isClosed: boolean
      entityId: SketchEntityId | null
      status: 'preview' | 'accepted'
      label: string
      isConstruction: boolean
    }

export interface SketchToolMetadata<TToolId extends SketchToolId = SketchToolId> {
  id: TToolId
  name: string
  tooltip: string
  icon: ToolIconId
  group: 'drawing'
  modes: readonly ToolbarMode[]
  dropdown?: {
    familyId: string
    variantIds: readonly SketchToolId[]
  }
}

export interface SketchToolRuntimeState {
  status: 'idle' | 'drawing'
  pointerDownPoint: SketchPoint | null
  livePoint: SketchPoint | null
  placedPoints?: readonly SketchPoint[]
  validationMessage: string | null
}

export interface SketchToolActivationResult {
  state: SketchToolRuntimeState
  stagedEntities: readonly SketchDraftEntity[]
  presentation: SketchToolPresentationSchema
}

export interface SketchToolPointerInput {
  state: SketchToolRuntimeState
  point: SketchPoint | null
}

export interface SketchToolPointerResult {
  state: SketchToolRuntimeState
  stagedEntities: readonly SketchDraftEntity[]
  presentation: SketchToolPresentationSchema
}

export interface SketchToolValidationResult {
  valid: boolean
  message: string | null
}

export interface SketchToolCommitFactories {
  createPointId(suffix: string): SketchPointId
  createEntityId(suffix: string): SketchEntityId
  createConstraintId(suffix: string): import('@/contracts/shared/ids').ConstraintId
  createDimensionId(suffix: string): import('@/contracts/shared/ids').DimensionId
  createPoint(label: string, pointId: SketchPointId, position: SketchPoint): SketchPointDefinition
  createLineEntity(
    label: string,
    entityId: SketchEntityId,
    startPointId: SketchPointId,
    endPointId: SketchPointId,
  ): SketchEntityDefinition
  createPointEntity(
    label: string,
    entityId: SketchEntityId,
    pointId: SketchPointId,
  ): SketchEntityDefinition
  createCircleEntity(
    label: string,
    entityId: SketchEntityId,
    centerPointId: SketchPointId,
    radius: number,
  ): SketchEntityDefinition
  createArcEntity(
    label: string,
    entityId: SketchEntityId,
    centerPointId: SketchPointId,
    startPointId: SketchPointId,
    endPointId: SketchPointId,
    sweepDirection: 'clockwise' | 'counterClockwise',
  ): SketchEntityDefinition
  createSplineEntity(
    label: string,
    entityId: SketchEntityId,
    fitPointIds: readonly SketchPointId[],
  ): SketchEntityDefinition
}

export interface SketchToolCommitInput {
  sequence: number
  start: SketchPoint
  end: SketchPoint
  points?: readonly SketchPoint[]
  isConstruction: boolean
  acceptedSnaps?: {
    start: SketchSnapCandidate | null
    end: SketchSnapCandidate | null
  }
  factories: SketchToolCommitFactories
}

export interface SketchToolCommitContribution {
  points: SketchPointDefinition[]
  entities: SketchEntityDefinition[]
  constraints?: ConstraintDefinition[]
  dimensions?: DimensionDefinition[]
}

export interface SketchToolDefinition<TToolId extends SketchToolId = SketchToolId> {
  metadata: SketchToolMetadata<TToolId>
  activate(): SketchToolActivationResult
  pointerMove(input: SketchToolPointerInput): SketchToolPointerResult
  pointerRelease(input: SketchToolPointerInput): SketchToolPointerResult
  getStagedEntities(state: SketchToolRuntimeState): readonly SketchDraftEntity[]
  validate(start: SketchPoint, end: SketchPoint): SketchToolValidationResult
  getPresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema
  createCommitContribution(input: SketchToolCommitInput): SketchToolCommitContribution
}
