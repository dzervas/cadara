import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchAuthoringOperation,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
} from '@/contracts/sketch/schema'
import type { SketchEntityId, SketchPointId } from '@/contracts/shared/ids'
import type { SketchPoint } from '@/contracts/modeling/schema'
import type { ToolMetadataBase } from '@/domain/tools/metadata'
import type { SketchToolControlValue, SketchToolPresentationSchema } from '@/domain/sketch-tools/editor-schema'
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
  | 'ellipse'
  | 'ellipticalArc'
  | 'conic'
  | 'bezierCurve'
  | 'inscribedPolygon'
  | 'circumscribedPolygon'
  | 'spline'
  | 'controlPointSpline'
  | 'profileText'

export interface SketchDraftEntityBase {
  id: string
  entityId: SketchEntityId | null
  status: 'preview' | 'accepted'
  label: string
  isConstruction: boolean
}

export type SketchDraftEntity =
  | SketchDraftEntityBase & {
      kind: 'line'
      start: SketchPoint
      end: SketchPoint
    }
  | SketchDraftEntityBase & {
      kind: 'circle'
      center: SketchPoint
      radius: number
    }
  | SketchDraftEntityBase & {
      kind: 'spline'
      points: readonly SketchPoint[]
    }
  | SketchDraftEntityBase & {
      kind: 'polyline'
      points: readonly SketchPoint[]
      isClosed: boolean
    }

export interface SketchToolMetadata<TToolId extends SketchToolId = SketchToolId> extends ToolMetadataBase<TToolId> {
  group: 'drawing'
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
  settings?: Record<string, SketchToolControlValue>
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
    degree?: 2 | 3,
  ): SketchEntityDefinition
  createEllipseEntity(
    label: string,
    entityId: SketchEntityId,
    centerPointId: SketchPointId,
    majorAxisPointId: SketchPointId,
    minorRadius: number,
  ): SketchEntityDefinition
  createEllipticalArcEntity(
    label: string,
    entityId: SketchEntityId,
    centerPointId: SketchPointId,
    majorAxisPointId: SketchPointId,
    startPointId: SketchPointId,
    endPointId: SketchPointId,
    minorRadius: number,
    sweepDirection: 'clockwise' | 'counterClockwise',
  ): SketchEntityDefinition
  createConicEntity(
    label: string,
    entityId: SketchEntityId,
    startPointId: SketchPointId,
    controlPointId: SketchPointId,
    endPointId: SketchPointId,
    rho: number,
  ): SketchEntityDefinition
  createBezierCurveEntity(
    label: string,
    entityId: SketchEntityId,
    controlPointIds: readonly SketchPointId[],
    degree: 2 | 3,
  ): SketchEntityDefinition
  createProfileTextEntity(
    label: string,
    entityId: SketchEntityId,
    anchorPointId: SketchPointId,
    text: string,
    height: number,
    rotationRadians: number,
    horizontalAlign: 'left' | 'center' | 'right',
    verticalAlign: 'baseline' | 'middle' | 'top' | 'bottom',
  ): SketchEntityDefinition
}

export interface SketchToolCommitInput {
  sequence: number
  start: SketchPoint
  end: SketchPoint
  points?: readonly SketchPoint[]
  settings?: Record<string, SketchToolControlValue>
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
  derivedRelationships?: SketchDerivationDefinition[]
  authoringOperation?: SketchAuthoringOperation
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
