import type {
  ExtrudeFeatureParameters,
  ExtrudeProfileRef,
  ExtrudeEndCondition,
  FeatureBooleanOperation,
  FeatureBooleanScope,
  FeatureDefinition,
  FilletFeatureParameters,
  ModelingDiagnostic,
  PlaneFeatureParameters,
  PreviewId,
  RevolveAxisRef,
  RevolveEndCondition,
  RevolveFeatureParameters,
  ShellFeatureParameters,
  StepImportFeatureParameters,
  AdvancedOperationIntentDescriptor,
  AdvancedFeatureOptionDescriptor,
  AdvancedParticipantDescriptor,
  AdvancedSolidFeatureParameters,
  AdvancedSolidOperationIntent,
  AuthoredFeatureKind,
  LoftAdvancedOptions,
  SweepAdvancedOptions,
} from '@/contracts/modeling/schema'
import type { AdvancedSolidFeatureDefinition } from '@/contracts/modeling/advanced-solid'
import type { MaybeAuthoredValue } from '@/contracts/modeling/authored-values'
import type { BodyId } from '@/contracts/shared/ids'
import type {
  ExtrudeFeatureSchemaVersion,
  FilletFeatureSchemaVersion,
  PlaneFeatureSchemaVersion,
  RevolveFeatureSchemaVersion,
  ShellFeatureSchemaVersion,
  StepImportFeatureSchemaVersion,
} from '@/contracts/shared/versioning'
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from '@/contracts/modeling/advanced-solid'
import type { FeatureId, PrimitiveRef, RevisionId, SelectionFilter } from '@/domain/editor/schema'
import type { ToolMetadataBase } from '@/domain/tools/metadata'
import type { FeatureEditorFormSchema } from '@/domain/feature-authoring/form-schema'

export interface ExtrudeFeatureParameterDraft {
  profileTargets: readonly ExtrudeProfileRef[]
  extentMode: 'oneSide' | 'symmetric' | 'twoSide'
  firstEnd: ExtrudeEndCondition
  secondEnd: ExtrudeEndCondition
  operation: MaybeAuthoredValue<FeatureBooleanOperation>
  booleanScope: FeatureBooleanScope
}

export interface RevolveFeatureParameterDraft {
  profileTargets: readonly ExtrudeProfileRef[]
  axisTarget: RevolveAxisRef | null
  startAngle: MaybeAuthoredValue<number>
  extentMode: 'oneSide' | 'symmetric' | 'twoSide'
  firstEnd: RevolveEndCondition
  secondEnd: Exclude<RevolveEndCondition, { kind: 'full' }>
  operation: MaybeAuthoredValue<FeatureBooleanOperation>
  booleanScope: FeatureBooleanScope
}

export interface FilletFeatureParameterDraft {
  edgeTargets: readonly Extract<PrimitiveRef, { kind: 'edge' }>[]
  radius: MaybeAuthoredValue<number>
}

export interface PlaneFeatureParameterDraft {
  referenceTarget: Extract<PrimitiveRef, { kind: 'construction' | 'face' }> | null
}

export interface ShellFeatureParameterDraft {
  bodyTarget: Extract<PrimitiveRef, { kind: 'body' }> | null
  faceTargets: readonly Extract<PrimitiveRef, { kind: 'face' }>[]
  thickness: MaybeAuthoredValue<number>
  direction: 'inside' | 'outside'
  operation: MaybeAuthoredValue<FeatureBooleanOperation>
  booleanScope: FeatureBooleanScope
}

export interface SweepFeatureParameterDraft {
  profileTargets: readonly Extract<PrimitiveRef, { kind: 'region' | 'face' }>[]
  pathTarget: Extract<PrimitiveRef, { kind: 'edge' | 'sketchEntity' }> | null
  guideCurveTargets: readonly Extract<PrimitiveRef, { kind: 'edge' | 'sketchEntity' }>[]
  lockProfileFaceTargets: readonly Extract<PrimitiveRef, { kind: 'face' }>[]
  lockProfileDirectionTarget: Extract<PrimitiveRef, { kind: 'edge' | 'construction' }> | null
  operationIntent: MaybeAuthoredValue<AdvancedSolidOperationIntent>
  targetBodyTargets: readonly Extract<PrimitiveRef, { kind: 'body' }>[]
  options: SweepAdvancedOptions & {
    twist: SweepAdvancedOptions['twist'] & {
      turns?: MaybeAuthoredValue<number>
      angle?: MaybeAuthoredValue<number>
      pitch?: MaybeAuthoredValue<number>
    }
  }
}

export interface LoftFeatureParameterDraft {
  profileTargets: readonly Extract<PrimitiveRef, { kind: 'region' | 'face' }>[]
  pathTarget: Extract<PrimitiveRef, { kind: 'edge' | 'sketchEntity' }> | null
  guideCurveTargets: readonly Extract<PrimitiveRef, { kind: 'edge' | 'sketchEntity' }>[]
  operationIntent: MaybeAuthoredValue<AdvancedSolidOperationIntent>
  targetBodyTargets: readonly Extract<PrimitiveRef, { kind: 'body' }>[]
  options: LoftAdvancedOptions
}

export interface ChamferFeatureParameterDraft {
  edgeTargets: readonly Extract<PrimitiveRef, { kind: 'edge' }>[]
  distance: MaybeAuthoredValue<number>
}

export interface ThickenFeatureParameterDraft {
  faceTargets: readonly Extract<PrimitiveRef, { kind: 'face' }>[]
  operationIntent: MaybeAuthoredValue<AdvancedSolidOperationIntent>
  targetBodyTargets: readonly Extract<PrimitiveRef, { kind: 'body' }>[]
  options: {
    thickness: MaybeAuthoredValue<number>
    side: MaybeAuthoredValue<'oneSide' | 'symmetric'>
    direction: 'positive' | 'negative'
  }
}

export interface CombineFeatureParameterDraft {
  targetBodyTargets: readonly Extract<PrimitiveRef, { kind: 'body' }>[]
  toolBodyTargets: readonly Extract<PrimitiveRef, { kind: 'body' }>[]
  operationIntent: MaybeAuthoredValue<Exclude<AdvancedSolidOperationIntent, 'create'>>
}

export interface SplitFeatureParameterDraft {
  targetBodyTarget: Extract<PrimitiveRef, { kind: 'body' }> | null
  toolBodyTarget: Extract<PrimitiveRef, { kind: 'body' }> | null
}

export interface DeleteSolidFeatureParameterDraft {
  bodyTargets: readonly Extract<PrimitiveRef, { kind: 'body' }>[]
}

export interface MirrorFeatureParameterDraft {
  bodyTargets: readonly Extract<PrimitiveRef, { kind: 'body' }>[]
  planeTarget: Extract<PrimitiveRef, { kind: 'construction' | 'face' }> | null
  copy: MaybeAuthoredValue<boolean>
}

export interface TransformFeatureParameterDraft {
  bodyTargets: readonly Extract<PrimitiveRef, { kind: 'body' }>[]
  transformReferenceTarget: Extract<PrimitiveRef, { kind: 'construction' | 'face' }> | null
  distance: MaybeAuthoredValue<number>
  direction: 'positive' | 'negative'
}

export type StepImportFeatureParameterDraft = StepImportFeatureParameters

export interface FeatureDraftByKind {
  extrude: ExtrudeFeatureParameterDraft
  revolve: RevolveFeatureParameterDraft
  fillet: FilletFeatureParameterDraft
  plane: PlaneFeatureParameterDraft
  shell: ShellFeatureParameterDraft
  stepImport: StepImportFeatureParameterDraft
  sweep: SweepFeatureParameterDraft
  loft: LoftFeatureParameterDraft
  chamfer: ChamferFeatureParameterDraft
  thicken: ThickenFeatureParameterDraft
  combine: CombineFeatureParameterDraft
  split: SplitFeatureParameterDraft
  deleteSolid: DeleteSolidFeatureParameterDraft
  mirror: MirrorFeatureParameterDraft
  transform: TransformFeatureParameterDraft
}

export interface FeatureParametersByKind {
  extrude: ExtrudeFeatureParameters
  revolve: RevolveFeatureParameters
  fillet: FilletFeatureParameters
  plane: PlaneFeatureParameters
  shell: ShellFeatureParameters
  stepImport: StepImportFeatureParameters
  sweep: AdvancedSolidFeatureParameters
  loft: AdvancedSolidFeatureParameters
  chamfer: AdvancedSolidFeatureParameters
  thicken: AdvancedSolidFeatureParameters
  combine: AdvancedSolidFeatureParameters
  split: AdvancedSolidFeatureParameters
  deleteSolid: AdvancedSolidFeatureParameters
  mirror: AdvancedSolidFeatureParameters
  transform: AdvancedSolidFeatureParameters
}

export interface FeatureVersionByKind {
  extrude: ExtrudeFeatureSchemaVersion
  revolve: RevolveFeatureSchemaVersion
  fillet: FilletFeatureSchemaVersion
  plane: PlaneFeatureSchemaVersion
  shell: ShellFeatureSchemaVersion
  stepImport: StepImportFeatureSchemaVersion
  sweep: typeof ADVANCED_SOLID_FEATURE_SCHEMA_VERSION
  loft: typeof ADVANCED_SOLID_FEATURE_SCHEMA_VERSION
  chamfer: typeof ADVANCED_SOLID_FEATURE_SCHEMA_VERSION
  thicken: typeof ADVANCED_SOLID_FEATURE_SCHEMA_VERSION
  combine: typeof ADVANCED_SOLID_FEATURE_SCHEMA_VERSION
  split: typeof ADVANCED_SOLID_FEATURE_SCHEMA_VERSION
  deleteSolid: typeof ADVANCED_SOLID_FEATURE_SCHEMA_VERSION
  mirror: typeof ADVANCED_SOLID_FEATURE_SCHEMA_VERSION
  transform: typeof ADVANCED_SOLID_FEATURE_SCHEMA_VERSION
}

export type FeatureDefinitionByKind<TKind extends AuthoredFeatureKind> =
  TKind extends 'sweep' | 'loft' | 'chamfer' | 'thicken' | 'combine' | 'split' | 'deleteSolid' | 'mirror' | 'transform'
    ? AdvancedSolidFeatureDefinition & { kind: TKind }
    : Extract<FeatureDefinition, { kind: TKind }>

export interface FeatureEditSessionStateBase {
  mode: 'create' | 'edit'
  featureId: FeatureId | null
  previewId: PreviewId
  status: 'idle' | 'previewing' | 'previewReady' | 'submitting'
  lastPreviewRevisionId: RevisionId | null
  lastCommittedRevisionId: RevisionId | null
  diagnostics: ModelingDiagnostic[]
}

export type FeatureEditSessionStateForKind<TKind extends AuthoredFeatureKind> = FeatureEditSessionStateBase & {
  featureType: TKind
  featureTypeVersion: FeatureVersionByKind[TKind]
  draft: FeatureDraftByKind[TKind]
}

export type ExtrudeFeatureEditSessionState = FeatureEditSessionStateForKind<'extrude'>
export type RevolveFeatureEditSessionState = FeatureEditSessionStateForKind<'revolve'>
export type FilletFeatureEditSessionState = FeatureEditSessionStateForKind<'fillet'>
export type PlaneFeatureEditSessionState = FeatureEditSessionStateForKind<'plane'>
export type ShellFeatureEditSessionState = FeatureEditSessionStateForKind<'shell'>
export type StepImportFeatureEditSessionState = FeatureEditSessionStateForKind<'stepImport'>
export type SweepFeatureEditSessionState = FeatureEditSessionStateForKind<'sweep'>
export type LoftFeatureEditSessionState = FeatureEditSessionStateForKind<'loft'>
export type ChamferFeatureEditSessionState = FeatureEditSessionStateForKind<'chamfer'>
export type ThickenFeatureEditSessionState = FeatureEditSessionStateForKind<'thicken'>
export type CombineFeatureEditSessionState = FeatureEditSessionStateForKind<'combine'>
export type SplitFeatureEditSessionState = FeatureEditSessionStateForKind<'split'>
export type DeleteSolidFeatureEditSessionState = FeatureEditSessionStateForKind<'deleteSolid'>
export type MirrorFeatureEditSessionState = FeatureEditSessionStateForKind<'mirror'>
export type TransformFeatureEditSessionState = FeatureEditSessionStateForKind<'transform'>

export type FeatureEditSessionState =
  | ExtrudeFeatureEditSessionState
  | RevolveFeatureEditSessionState
  | FilletFeatureEditSessionState
  | PlaneFeatureEditSessionState
  | ShellFeatureEditSessionState
  | StepImportFeatureEditSessionState
  | SweepFeatureEditSessionState
  | LoftFeatureEditSessionState
  | ChamferFeatureEditSessionState
  | ThickenFeatureEditSessionState
  | CombineFeatureEditSessionState
  | SplitFeatureEditSessionState
  | DeleteSolidFeatureEditSessionState
  | MirrorFeatureEditSessionState
  | TransformFeatureEditSessionState

export type FeatureDraftPatch = Record<string, unknown>

export interface FeatureAuthoringMetadata<TKind extends AuthoredFeatureKind = AuthoredFeatureKind>
  extends Omit<ToolMetadataBase<TKind>, 'id'> {
  kind: TKind
  toolId: TKind
  groupId: 'features' | 'transforms'
}

export interface CreateFeatureDraftInput {
  selectedTarget: PrimitiveRef | null
}

export interface FeatureAuthoringDefinition<TKind extends AuthoredFeatureKind = AuthoredFeatureKind> {
  metadata: FeatureAuthoringMetadata<TKind>
  featureTypeVersion: FeatureVersionByKind[TKind]
  selectionFilter: SelectionFilter
  advancedParticipants?: readonly AdvancedParticipantDescriptor[]
  advancedOptions?: readonly AdvancedFeatureOptionDescriptor[]
  operationIntent?: AdvancedOperationIntentDescriptor
  createDraft(input: CreateFeatureDraftInput): FeatureDraftByKind[TKind]
  hydrateDraft(feature: FeatureDefinitionByKind<TKind>): FeatureDraftByKind[TKind]
  applyPatch(draft: FeatureDraftByKind[TKind], patch: FeatureDraftPatch): FeatureDraftByKind[TKind]
  applySelection(draft: FeatureDraftByKind[TKind], target: PrimitiveRef): FeatureDraftByKind[TKind]
  getPrimarySelectionTarget(draft: FeatureDraftByKind[TKind]): PrimitiveRef | null
  getPreviewLabel(draft: FeatureDraftByKind[TKind], prefix: string): string
  getMissingInputsDiagnostics(input: {
    draft: FeatureDraftByKind[TKind]
    phase: 'preview' | 'commit'
  }): ModelingDiagnostic[]
  buildDefinition(draft: FeatureDraftByKind[TKind]): FeatureDefinitionByKind<TKind> | null
  getFormSchema(session: FeatureEditSessionStateForKind<TKind>): FeatureEditorFormSchema
}

export function isBooleanOperation(value: unknown): value is FeatureBooleanOperation {
  return value === 'newBody' || value === 'join' || value === 'cut' || value === 'intersect'
}

export function getBooleanScopeBodyTargets(
  booleanScope: FeatureBooleanScope,
): readonly Extract<PrimitiveRef, { kind: 'body' }>[] {
  if (booleanScope.kind === 'targetBody') {
    return [{ kind: 'body', bodyId: booleanScope.bodyId }]
  }

  if (booleanScope.kind === 'targetBodies') {
    return booleanScope.bodyIds.map((bodyId) => ({ kind: 'body', bodyId }))
  }

  return []
}

export function hasBooleanTargetScope(
  operation: FeatureBooleanOperation,
  booleanScope: FeatureBooleanScope,
): boolean {
  return operation === 'newBody'
    ? booleanScope.kind === 'standalone'
    : getBooleanScopeBodyTargets(booleanScope).length > 0
}

export function toBodyIds(value: unknown): readonly BodyId[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const bodyIds = value.map((entry) => {
    if (typeof entry === 'string') {
      return entry as BodyId
    }

    return entry && typeof entry === 'object' && 'kind' in entry && entry.kind === 'body' && 'bodyId' in entry && typeof entry.bodyId === 'string'
      ? entry.bodyId as BodyId
      : null
  })

  return bodyIds.some((entry) => entry === null) ? null : bodyIds as readonly BodyId[]
}

export function toBooleanScope(patch: FeatureDraftPatch, current: FeatureBooleanScope): FeatureBooleanScope {
  if (patch.booleanScope && typeof patch.booleanScope === 'object' && patch.booleanScope !== null) {
    const next = patch.booleanScope as Partial<FeatureBooleanScope> & { kind?: string }

    if (next.kind === 'standalone') {
      return { kind: 'standalone' }
    }

    if (next.kind === 'targetBody' && typeof (next as { bodyId?: unknown }).bodyId === 'string') {
      return { kind: 'targetBody', bodyId: (next as { bodyId: BodyId }).bodyId }
    }

    if (next.kind === 'targetBodies') {
      const bodyIds = toBodyIds((next as { bodyIds?: unknown }).bodyIds)
      if (bodyIds) {
        return { kind: 'targetBodies', bodyIds }
      }
    }
  }

  if (patch.operation === 'newBody') {
    return { kind: 'standalone' }
  }

  if (typeof patch.booleanTargetBodyId === 'string') {
    return { kind: 'targetBody', bodyId: patch.booleanTargetBodyId as BodyId }
  }

  const bodyIds = toBodyIds(patch.booleanTargetBodyIds)
  if (bodyIds) {
    if (bodyIds.length === 0) {
      return { kind: 'standalone' }
    }

    return bodyIds.length === 1
      ? { kind: 'targetBody', bodyId: bodyIds[0]! }
      : { kind: 'targetBodies', bodyIds }
  }

  return current
}
