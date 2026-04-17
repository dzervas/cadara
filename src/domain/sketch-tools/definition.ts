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

export type SketchToolId = 'line' | 'rectangle' | 'circle'

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

export interface SketchToolMetadata<TToolId extends SketchToolId = SketchToolId> {
  id: TToolId
  name: string
  tooltip: string
  icon: ToolIconId
  group: 'drawing'
  modes: readonly ToolbarMode[]
}

export interface SketchToolRuntimeState {
  status: 'idle' | 'drawing'
  pointerDownPoint: SketchPoint | null
  livePoint: SketchPoint | null
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
  createCircleEntity(
    label: string,
    entityId: SketchEntityId,
    centerPointId: SketchPointId,
    radius: number,
  ): SketchEntityDefinition
}

export interface SketchToolCommitInput {
  sequence: number
  start: SketchPoint
  end: SketchPoint
  isConstruction: boolean
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
