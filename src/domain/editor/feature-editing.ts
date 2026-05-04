import type { AuthoredFeatureKind, FeatureDefinition, FeatureSnapshotRecord } from '@/contracts/modeling/schema'
import type { FeatureId, PrimitiveRef, SelectionFilter } from '@/core/editor/schema'
import type {
  FeatureDraftPatch,
  FeatureEditSessionState,
  FeatureEditSessionStateBase,
  FeatureEditSessionStateForKind,
} from '@/core/feature-authoring/definition'
import {
  getFeatureAuthoringDefinition,
  findFeatureAuthoringDefinition,
} from '@/core/feature-authoring/registry'
import type { FeatureEditorFormField, FeatureEditorFormSchema } from '@/core/feature-authoring/form-schema'
import {
  featureSupportsBooleanTargetPreselection,
  isBooleanOperationPatch,
  isBooleanTargetPatch,
} from './feature-boolean-target-preselection'

export type {
  ExtrudeFeatureEditSessionState,
  ExtrudeFeatureParameterDraft,
  FeatureDraftPatch,
  FeatureEditSessionState,
  FeatureEditSessionStateBase,
  CombineFeatureEditSessionState,
  CombineFeatureParameterDraft,
  ChamferFeatureEditSessionState,
  ChamferFeatureParameterDraft,
  FilletFeatureEditSessionState,
  FilletFeatureParameterDraft,
  LoftFeatureEditSessionState,
  LoftFeatureParameterDraft,
  PlaneFeatureEditSessionState,
  PlaneFeatureParameterDraft,
  RevolveFeatureEditSessionState,
  RevolveFeatureParameterDraft,
  ShellFeatureEditSessionState,
  ShellFeatureParameterDraft,
  SweepFeatureEditSessionState,
  SweepFeatureParameterDraft,
  SplitFeatureEditSessionState,
  SplitFeatureParameterDraft,
  ThickenFeatureEditSessionState,
  ThickenFeatureParameterDraft,
  DeleteSolidFeatureEditSessionState,
  DeleteSolidFeatureParameterDraft,
  MirrorFeatureEditSessionState,
  MirrorFeatureParameterDraft,
  TransformFeatureEditSessionState,
  TransformFeatureParameterDraft,
} from '@/core/feature-authoring/definition'

function createBaseFeatureSession(
  featureType: FeatureEditSessionState['featureType'],
  featureId: FeatureId | null,
): FeatureEditSessionStateBase {
  const previewSeed = featureId ?? `${featureType}-create`

  return {
    mode: featureId ? 'edit' : 'create',
    featureId,
    previewId: `preview_${previewSeed}`,
    status: 'idle',
    lastPreviewRevisionId: null,
    lastCommittedRevisionId: null,
    diagnostics: [],
    booleanTargetPreselection: {
      operationManuallyChanged: featureId !== null,
      targetManuallyChanged: featureId !== null,
    },
  }
}

function createSessionForDefinition<TKind extends AuthoredFeatureKind>(
  featureType: TKind,
  base: FeatureEditSessionStateBase,
  draft: FeatureEditSessionStateForKind<TKind>['draft'],
): FeatureEditSessionStateForKind<TKind> {
  const definition = getFeatureAuthoringDefinition(featureType)

  return {
    ...base,
    featureType,
    featureTypeVersion: definition.featureTypeVersion,
    draft,
  }
}

export function getSelectionFilterForFeatureType(
  featureType: FeatureEditSessionState['featureType'],
): SelectionFilter {
  return getFeatureAuthoringDefinition(featureType).selectionFilter
}

function featureDraftChanged(
  previousSession: FeatureEditSessionState,
  nextSession: FeatureEditSessionState,
) {
  return JSON.stringify(previousSession.draft) !== JSON.stringify(nextSession.draft)
}

export function adoptCompatibleFeatureSelection(
  featureType: FeatureEditSessionState['featureType'],
  selectedTargets: readonly PrimitiveRef[],
): PrimitiveRef[] {
  let session = createFeatureEditSession({ featureType, selectedTarget: null })
  const adoptedTargets: PrimitiveRef[] = []

  for (const target of selectedTargets) {
    const nextSession = adoptedTargets.length === 0
      ? createFeatureEditSession({ featureType, selectedTarget: target })
      : applySelectionToFeatureEditSession(session, target)

    if (!featureDraftChanged(session, nextSession)) {
      return []
    }

    adoptedTargets.push(target)
    session = nextSession
  }

  return adoptedTargets
}

export function createFeatureEditSession(input: {
  featureType: FeatureEditSessionState['featureType']
  selectedTarget?: PrimitiveRef | null
  selectedTargets?: readonly PrimitiveRef[]
  featureId?: FeatureId | null
}): FeatureEditSessionState {
  const featureId = input.featureId ?? null
  const definition = getFeatureAuthoringDefinition(input.featureType)
  const selectedTargets = input.selectedTargets ?? (input.selectedTarget ? [input.selectedTarget] : [])
  const selectedTarget = selectedTargets[0] ?? input.selectedTarget ?? null

  let session = createSessionForDefinition(
    input.featureType,
    createBaseFeatureSession(input.featureType, featureId),
    definition.createDraft({ selectedTarget }),
  ) as FeatureEditSessionState

  for (const target of selectedTargets.slice(1)) {
    session = {
      ...session,
      draft: definition.applySelection(session.draft, target),
    } as FeatureEditSessionState
  }

  return session
}

export function hydrateFeatureEditSession(
  feature: FeatureSnapshotRecord,
): FeatureEditSessionState | null {
  if (
    feature.definition.kind !== 'extrude'
    && feature.definition.kind !== 'fillet'
    && feature.definition.kind !== 'plane'
    && feature.definition.kind !== 'revolve'
    && feature.definition.kind !== 'shell'
    && feature.definition.kind !== 'sweep'
    && feature.definition.kind !== 'loft'
    && feature.definition.kind !== 'chamfer'
    && feature.definition.kind !== 'thicken'
    && feature.definition.kind !== 'combine'
    && feature.definition.kind !== 'split'
    && feature.definition.kind !== 'deleteSolid'
    && feature.definition.kind !== 'mirror'
    && feature.definition.kind !== 'transform'
  ) {
    return null
  }

  const definition = findFeatureAuthoringDefinition(feature.definition.kind)

  if (!definition) {
    return null
  }

  return createSessionForDefinition(
    feature.definition.kind,
    {
      ...createBaseFeatureSession(feature.definition.kind, feature.featureId),
      mode: 'edit',
    },
    definition.hydrateDraft(feature.definition as never),
  ) as FeatureEditSessionState
}

export function patchFeatureEditSession(
  session: FeatureEditSessionState,
  patch: FeatureDraftPatch,
): FeatureEditSessionState {
  const definition = getFeatureAuthoringDefinition(session.featureType)
  return {
    ...session,
    draft: definition.applyPatch(session.draft, patch),
    booleanTargetPreselection: {
      operationManuallyChanged:
        session.booleanTargetPreselection.operationManuallyChanged || isBooleanOperationPatch(patch),
      targetManuallyChanged:
        session.booleanTargetPreselection.targetManuallyChanged || isBooleanTargetPatch(patch),
    },
  } as FeatureEditSessionState
}

export function applySelectionToFeatureEditSession(
  session: FeatureEditSessionState,
  target: PrimitiveRef,
): FeatureEditSessionState {
  const definition = getFeatureAuthoringDefinition(session.featureType)
  const nextDraft = definition.applySelection(session.draft, target)
  return {
    ...session,
    draft: nextDraft,
    booleanTargetPreselection: {
      ...session.booleanTargetPreselection,
      targetManuallyChanged:
        session.booleanTargetPreselection.targetManuallyChanged
        || (
          target.kind === 'body'
          && featureSupportsBooleanTargetPreselection(session.featureType)
          && JSON.stringify(nextDraft) !== JSON.stringify(session.draft)
        ),
    },
  } as FeatureEditSessionState
}

export function buildFeatureDefinition(
  session: FeatureEditSessionState,
): FeatureDefinition | null {
  const definition = getFeatureAuthoringDefinition(session.featureType)
  return definition.buildDefinition(session.draft) as FeatureDefinition | null
}

export function getFeaturePrimarySelectionTarget(
  session: FeatureEditSessionState,
): PrimitiveRef | null {
  const definition = getFeatureAuthoringDefinition(session.featureType)
  return definition.getPrimarySelectionTarget(session.draft)
}

export function getFeatureSessionPreviewLabel(
  session: FeatureEditSessionState,
  prefix = 'Draft',
): string {
  const definition = getFeatureAuthoringDefinition(session.featureType)
  return definition.getPreviewLabel(session.draft, prefix)
}

export function createPreviewMissingInputsDiagnostics(
  session: FeatureEditSessionState,
) {
  const definition = getFeatureAuthoringDefinition(session.featureType)
  return definition.getMissingInputsDiagnostics({ draft: session.draft, phase: 'preview' })
}

export function createCommitMissingInputsDiagnostics(
  session: FeatureEditSessionState,
) {
  const definition = getFeatureAuthoringDefinition(session.featureType)
  return definition.getMissingInputsDiagnostics({ draft: session.draft, phase: 'commit' })
}

export function getFeatureEditorFormSchema(
  session: FeatureEditSessionState,
): FeatureEditorFormSchema {
  const definition = getFeatureAuthoringDefinition(session.featureType)
  return definition.getFormSchema(session as never)
}

export function getFeatureEditorFormField(
  session: FeatureEditSessionState,
  fieldId: string,
): FeatureEditorFormField | null {
  for (const section of getFeatureEditorFormSchema(session).sections) {
    const field = section.fields.find((entry) => entry.id === fieldId)
    if (field) {
      return field
    }
  }

  return null
}
