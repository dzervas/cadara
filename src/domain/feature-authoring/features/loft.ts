import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  LOFT_ADVANCED_OPTION_DESCRIPTORS,
  type AdvancedParticipantRole,
  type AdvancedSolidOperationIntent,
  type LoftGuideContinuity,
  type LoftProfileConditionKind,
} from '@/contracts/modeling/advanced-solid'
import { isExpressionAuthoredValue } from '@/contracts/modeling/authored-values'
import { createSelectionFilterForRequirement, primitiveRefEquals, loftSelectionFilter, type PrimitiveRef } from '@/domain/editor/schema'
import type { FeatureAuthoringDefinition, LoftFeatureParameterDraft } from '@/domain/feature-authoring/definition'
import {
  acceptAuthoredPatch,
  appendUniqueTarget,
  asBodyRef,
  asExtrudeProfileRef,
  asSweepPathRef,
  authoredDefinitionValue,
  authoredNumberFormValue,
  authoredNumberLiteral,
  authoredStringLiteral,
  buildAdvancedSolidParticipants,
  createAdvancedOperationIntentFields,
  createMissingInputDiagnostic,
  createReferenceCollectionField,
  filterTargets,
  isAdvancedOperationIntent,
  toFeaturePhaseDiagnostics,
  validateAdvancedSolidDraft,
} from '@/domain/feature-authoring/features/shared'

const loftParticipants = [
  {
    role: 'profile',
    label: 'Profile targets',
    required: true,
    cardinality: { min: 2, max: null },
    acceptedKinds: ['region', 'face'],
  },
  {
    role: 'path',
    label: 'Path target',
    required: false,
    cardinality: { min: 0, max: 1 },
    acceptedKinds: ['edge', 'sketchEntity'],
  },
  {
    role: 'guideCurve',
    label: 'Guide curve targets',
    required: false,
    cardinality: { min: 0, max: null },
    acceptedKinds: ['edge', 'sketchEntity'],
  },
  {
    role: 'targetBody',
    label: 'Boolean target bodies',
    required: false,
    cardinality: { min: 0, max: null },
    acceptedKinds: ['body'],
  },
] as const

const loftOperationIntent = {
  supportedIntents: ['create', 'add', 'subtract', 'intersect'],
  requiredParticipantsByIntent: {
    add: ['targetBody'],
    subtract: ['targetBody'],
    intersect: ['targetBody'],
  },
} as const

function getTargetsForRole(draft: LoftFeatureParameterDraft, role: AdvancedParticipantRole) {
  switch (role) {
    case 'profile':
      return draft.profileTargets
    case 'path':
      return draft.pathTarget ? [draft.pathTarget] : []
    case 'guideCurve':
      return draft.guideCurveTargets
    case 'targetBody':
      return draft.targetBodyTargets
    default:
      return []
  }
}

function isLoftGuideContinuity(value: unknown): value is LoftGuideContinuity {
  return value === 'none' ||
    value === 'normalToGuide' ||
    value === 'tangentToGuide' ||
    value === 'matchTangent' ||
    value === 'matchCurvature'
}

function isLoftProfileConditionKind(value: unknown): value is LoftProfileConditionKind {
  return value === 'none' || value === 'normal' || value === 'tangent'
}

function isLoftConnectionTarget(value: unknown): value is Extract<PrimitiveRef, { kind: 'edge' | 'vertex' }> {
  return !!value && typeof value === 'object' && (
    ((value as PrimitiveRef).kind === 'edge') ||
    ((value as PrimitiveRef).kind === 'vertex')
  )
}

function getDefaultLoftOptions(): LoftFeatureParameterDraft['options'] {
  return {
    path: { sectionCount: 5 },
    guideContinuity: 'none',
    profileConditions: getDefaultLoftProfileConditions(),
    matchConnections: [],
  }
}

function getDefaultLoftProfileConditions(): NonNullable<LoftFeatureParameterDraft['options']['profileConditions']> {
  return {
    startCondition: 'none',
    startMagnitude: 1,
    endCondition: 'none',
    endMagnitude: 1,
  }
}

function getLoftPathOptions(options: LoftFeatureParameterDraft['options']) {
  return options.path ?? { sectionCount: 5 }
}

function getLoftProfileConditions(options: LoftFeatureParameterDraft['options']) {
  return options.profileConditions ?? getDefaultLoftProfileConditions()
}

function filterMatchConnections(value: unknown): NonNullable<LoftFeatureParameterDraft['options']['matchConnections']> {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is NonNullable<LoftFeatureParameterDraft['options']['matchConnections']>[number] =>
    !!entry &&
    typeof entry === 'object' &&
    isLoftConnectionTarget((entry as { from?: unknown }).from) &&
    isLoftConnectionTarget((entry as { to?: unknown }).to),
  )
}

function hydrateLoftProfileConditions(value: unknown): NonNullable<LoftFeatureParameterDraft['options']['profileConditions']> {
  const defaults = getDefaultLoftProfileConditions()
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaults
  }

  const record = value as Partial<NonNullable<LoftFeatureParameterDraft['options']['profileConditions']>>
  return {
    startCondition: record.startCondition ?? defaults.startCondition,
    startMagnitude: record.startMagnitude ?? defaults.startMagnitude,
    endCondition: record.endCondition ?? defaults.endCondition,
    endMagnitude: record.endMagnitude ?? defaults.endMagnitude,
  }
}

function updateLoftOptions(
  current: LoftFeatureParameterDraft['options'],
  patch: Record<string, unknown>,
): LoftFeatureParameterDraft['options'] {
  const currentPath = getLoftPathOptions(current)
  const pathPatch = patch.path && typeof patch.path === 'object' && !Array.isArray(patch.path)
    ? patch.path as Record<string, unknown>
    : {}
  const currentProfileConditions = getLoftProfileConditions(current)
  const profileConditionsPatch = patch.profileConditions && typeof patch.profileConditions === 'object' && !Array.isArray(patch.profileConditions)
    ? patch.profileConditions as Record<string, unknown>
    : {}

  return {
    ...current,
    path: {
      ...currentPath,
      sectionCount: acceptAuthoredPatch(
        pathPatch.sectionCount,
        currentPath.sectionCount,
        (value): value is number => typeof value === 'number',
      ),
    },
    guideContinuity: acceptAuthoredPatch(
      patch.guideContinuity,
      current.guideContinuity ?? 'none',
      isLoftGuideContinuity,
    ),
    profileConditions: {
      ...currentProfileConditions,
      startCondition: acceptAuthoredPatch(
        profileConditionsPatch.startCondition,
        currentProfileConditions.startCondition,
        isLoftProfileConditionKind,
      ),
      startMagnitude: acceptAuthoredPatch(
        profileConditionsPatch.startMagnitude,
        currentProfileConditions.startMagnitude ?? 1,
        (value): value is number => typeof value === 'number',
      ),
      endCondition: acceptAuthoredPatch(
        profileConditionsPatch.endCondition,
        currentProfileConditions.endCondition,
        isLoftProfileConditionKind,
      ),
      endMagnitude: acceptAuthoredPatch(
        profileConditionsPatch.endMagnitude,
        currentProfileConditions.endMagnitude ?? 1,
        (value): value is number => typeof value === 'number',
      ),
    },
    matchConnections: patch.matchConnections === undefined
      ? current.matchConnections ?? []
      : filterMatchConnections(patch.matchConnections),
  }
}

function buildLoftParticipants(draft: LoftFeatureParameterDraft) {
  return buildAdvancedSolidParticipants(loftParticipants, (role) => getTargetsForRole(draft, role))
}

function getLoftValidationDiagnostics(draft: LoftFeatureParameterDraft) {
  return validateAdvancedSolidDraft({
    featureKind: 'loft',
    operationIntent: draft.operationIntent,
    participants: buildLoftParticipants(draft),
    participantDescriptors: loftParticipants,
    operationIntentDescriptor: loftOperationIntent,
    optionDescriptors: LOFT_ADVANCED_OPTION_DESCRIPTORS,
    options: draft.options,
  })
}

function moveTarget(
  targets: readonly Extract<PrimitiveRef, { kind: 'region' | 'face' }>[],
  target: PrimitiveRef | null,
  direction: -1 | 1,
) {
  const index = target ? targets.findIndex((entry) => primitiveRefEquals(entry, target)) : -1
  if (index < 0) {
    return targets
  }

  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= targets.length) {
    return targets
  }

  const next = [...targets]
  const [moved] = next.splice(index, 1)
  next.splice(nextIndex, 0, moved!)
  return next
}

export const loftAuthoringDefinition = {
  metadata: {
    kind: 'loft',
    name: 'Loft',
    tooltip: 'Create a lofted solid from ordered profiles.',
    icon: 'loft',
    toolId: 'loft',
    groupId: 'features',
    modes: ['part'],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: loftSelectionFilter,
  advancedParticipants: loftParticipants,
  advancedOptions: LOFT_ADVANCED_OPTION_DESCRIPTORS,
  operationIntent: loftOperationIntent,
  createDraft(input) {
    const profileTarget = asExtrudeProfileRef(input.selectedTarget)
    return {
      profileTargets: profileTarget ? [profileTarget] : [],
      pathTarget: null,
      guideCurveTargets: [],
      operationIntent: 'create',
      targetBodyTargets: [],
      options: getDefaultLoftOptions(),
    }
  },
  hydrateDraft(feature) {
    const getParticipantTargets = (role: AdvancedParticipantRole) =>
      feature.parameters.participants.find((participant) => participant.role === role)?.targets ?? []

    return {
      profileTargets: filterTargets(getParticipantTargets('profile'), asExtrudeProfileRef),
      pathTarget: filterTargets(getParticipantTargets('path'), asSweepPathRef)[0] ?? null,
      guideCurveTargets: filterTargets(getParticipantTargets('guideCurve'), asSweepPathRef),
      operationIntent: feature.parameters.operationIntent ?? 'create',
      targetBodyTargets: filterTargets(getParticipantTargets('targetBody'), asBodyRef),
      options: {
        ...getDefaultLoftOptions(),
        ...feature.parameters.options,
        path: {
          sectionCount: (
            (feature.parameters.options?.path as { sectionCount?: unknown } | undefined)?.sectionCount ??
            feature.parameters.options?.sectionCount ??
            5
          ) as NonNullable<LoftFeatureParameterDraft['options']['path']>['sectionCount'],
        },
        profileConditions: hydrateLoftProfileConditions(feature.parameters.options?.profileConditions),
        matchConnections: filterMatchConnections(feature.parameters.options?.matchConnections),
      },
    }
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      profileTargets:
        patch.profileTargets === undefined
          ? patch.moveProfileTargetEarlier !== undefined
            ? moveTarget(draft.profileTargets, patch.moveProfileTargetEarlier as PrimitiveRef | null, -1)
            : patch.moveProfileTargetLater !== undefined
              ? moveTarget(draft.profileTargets, patch.moveProfileTargetLater as PrimitiveRef | null, 1)
              : draft.profileTargets
          : filterTargets(patch.profileTargets, asExtrudeProfileRef),
      pathTarget:
        patch.pathTarget === undefined
          ? draft.pathTarget
          : asSweepPathRef(patch.pathTarget as PrimitiveRef | null),
      guideCurveTargets:
        patch.guideCurveTargets === undefined
          ? draft.guideCurveTargets
          : filterTargets(patch.guideCurveTargets, asSweepPathRef),
      operationIntent: acceptAuthoredPatch(patch.operationIntent, draft.operationIntent, isAdvancedOperationIntent),
      targetBodyTargets:
        patch.targetBodyTargets === undefined
          ? draft.targetBodyTargets
          : filterTargets(patch.targetBodyTargets, asBodyRef),
      options: patch.options && typeof patch.options === 'object' && !Array.isArray(patch.options)
        ? updateLoftOptions(draft.options, patch.options as Record<string, unknown>)
        : draft.options,
    }
  },
  applySelection(draft, target) {
    const profileTarget = asExtrudeProfileRef(target)
    if (profileTarget) {
      return {
        ...draft,
        profileTargets: appendUniqueTarget(draft.profileTargets, profileTarget),
      }
    }

    const guideCurveTarget = asSweepPathRef(target)
    if (guideCurveTarget) {
      return {
        ...draft,
        guideCurveTargets: appendUniqueTarget(draft.guideCurveTargets, guideCurveTarget),
      }
    }

    const bodyTarget = asBodyRef(target)
    return bodyTarget && authoredStringLiteral(draft.operationIntent, 'create') !== 'create'
      ? this.applyPatch(draft, { targetBodyTargets: appendUniqueTarget(draft.targetBodyTargets, bodyTarget) })
      : draft
  },
  getPrimarySelectionTarget(draft) {
    return draft.profileTargets[0] ?? draft.pathTarget ?? draft.guideCurveTargets[0] ?? draft.targetBodyTargets[0] ?? null
  },
  getPreviewLabel(draft, prefix) {
    if (draft.profileTargets.length < 2) {
      return 'Select at least two sketch regions or planar faces for loft'
    }
    if (authoredStringLiteral(draft.operationIntent, 'create') !== 'create' && draft.targetBodyTargets.length === 0) {
      return 'Select a target body for loft boolean operation'
    }
    return `${prefix} loft with explicit profile order`
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getLoftValidationDiagnostics(input.draft)
    if (diagnostics.length > 0) {
      return toFeaturePhaseDiagnostics({ phase: input.phase, diagnostics })
    }

    return [createMissingInputDiagnostic({
      feature: 'loft',
      phase: input.phase,
      suffix: 'references',
      message: 'Loft preview requires at least two ordered profile references.',
    })]
  },
  buildDefinition(draft) {
    const pathOptions = getLoftPathOptions(draft.options)
    const profileConditions = getLoftProfileConditions(draft.options)
    return getLoftValidationDiagnostics(draft).length === 0
      ? {
          kind: 'loft',
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            operationIntent: authoredDefinitionValue(draft.operationIntent, 'create') as AdvancedSolidOperationIntent,
            participants: buildLoftParticipants(draft),
            options: {
              ...(draft.pathTarget
                ? {
                    path: {
                      sectionCount: authoredDefinitionValue(pathOptions.sectionCount, 5),
                    },
                  }
                : {}),
              guideContinuity: authoredDefinitionValue(draft.options.guideContinuity ?? 'none', 'none'),
              profileConditions: {
                startCondition: authoredDefinitionValue(profileConditions.startCondition, 'none'),
                startMagnitude: authoredDefinitionValue(profileConditions.startMagnitude ?? 1, 1),
                endCondition: authoredDefinitionValue(profileConditions.endCondition, 'none'),
                endMagnitude: authoredDefinitionValue(profileConditions.endMagnitude ?? 1, 1),
              },
              ...((draft.options.matchConnections?.length ?? 0) > 0
                ? { matchConnections: draft.options.matchConnections }
                : {}),
            },
          },
        }
      : null
  },
  getFormSchema(session) {
    const diagnostics = session.diagnostics
    const operationIntent = authoredStringLiteral(session.draft.operationIntent, 'create')
    const pathOptions = getLoftPathOptions(session.draft.options)
    const profileConditions = getLoftProfileConditions(session.draft.options)
    const guideContinuity = authoredStringLiteral(session.draft.options.guideContinuity ?? 'none', 'none')
    const startCondition = authoredStringLiteral(profileConditions.startCondition, 'none')
    const endCondition = authoredStringLiteral(profileConditions.endCondition, 'none')
    const sectionCount = authoredNumberLiteral(pathOptions.sectionCount)
    const sectionCountIsValid = isExpressionAuthoredValue(pathOptions.sectionCount)
      || (sectionCount !== null && Number.isInteger(sectionCount) && sectionCount > 0)
    const startMagnitude = authoredNumberLiteral(profileConditions.startMagnitude ?? 1)
    const endMagnitude = authoredNumberLiteral(profileConditions.endMagnitude ?? 1)
    const startMagnitudeIsValid = isExpressionAuthoredValue(profileConditions.startMagnitude)
      || (startMagnitude !== null && startMagnitude > 0)
    const endMagnitudeIsValid = isExpressionAuthoredValue(profileConditions.endMagnitude)
      || (endMagnitude !== null && endMagnitude > 0)
    return {
      sections: [
        {
          id: 'references',
          title: 'References',
          fields: [
            createReferenceCollectionField({
              id: 'loft-profiles',
              label: 'Profile targets',
              value: session.draft.profileTargets,
              helper: 'Accepted targets: derived sketch regions or planar faces. Order is preserved and drives the loft sections.',
              error: session.draft.profileTargets.length >= 2 ? null : { message: 'Select at least two profile targets.' },
              participant: loftParticipants[0],
              selectionFilter: loftSelectionFilter,
              selectionRequirementId: 'loft-profile',
              selectionRequirementLabel: 'Loft profile',
              itemLabel: 'Profile',
              patchKey: 'profileTargets',
              ordering: {
                moveUpPatchKey: 'moveProfileTargetEarlier',
                moveDownPatchKey: 'moveProfileTargetLater',
              },
            }),
            {
              kind: 'referencePicker',
              id: 'loft-path',
              label: 'Path',
              value: session.draft.pathTarget,
              emptyLabel: 'None selected',
              helper: 'Optional centerline-like path control, stored separately from guide curves.',
              advancedParticipant: {
                role: 'path',
                required: false,
                cardinality: { min: 0, max: 1 },
                selectedCount: session.draft.pathTarget ? 1 : 0,
              },
              picker: {
                mode: 'replace',
                allowsMultiple: false,
                selectionFilter: createSelectionFilterForRequirement(
                  loftSelectionFilter,
                  'loft-path',
                  'Loft path',
                ),
                itemLabel: 'Path',
              },
              patch: { patchKey: 'pathTarget' },
            },
            createReferenceCollectionField({
              id: 'loft-guide-curves',
              label: 'Guide curves',
              value: session.draft.guideCurveTargets,
              helper: 'Guide curves are stored separately from path controls.',
              participant: loftParticipants[2],
              selectionFilter: loftSelectionFilter,
              selectionRequirementId: 'loft-guide-curve',
              selectionRequirementLabel: 'Loft guide curve',
              itemLabel: 'Guide curve',
              patchKey: 'guideCurveTargets',
            }),
          ],
        },
        {
          id: 'parameters',
          title: 'Parameters',
          fields: [
            ...createAdvancedOperationIntentFields({
              prefix: 'loft',
              operationIntent,
              operationValue: session.draft.operationIntent,
              targetBodyTargets: session.draft.targetBodyTargets,
              selectionFilter: loftSelectionFilter,
              selectionRequirementId: 'loft-boolean-target',
              selectionRequirementLabel: 'Loft target body',
            }),
            {
              kind: 'optionGroup',
              id: 'loft-path-options',
              label: 'Path options',
              hidden: !session.draft.pathTarget,
              fields: [
                {
                  kind: 'numeric',
                  id: 'loft-section-count',
                  label: 'Section count',
                  value: authoredNumberFormValue(pathOptions.sectionCount),
                  input: 'number',
                  step: 1,
                  authoredValue: {
                    expressionCapable: true,
                    valueKind: { kind: 'positiveInteger' },
                    source: isExpressionAuthoredValue(pathOptions.sectionCount) ? 'expression' : 'literal',
                    expressionText: isExpressionAuthoredValue(pathOptions.sectionCount) ? pathOptions.sectionCount.valueText : null,
                  },
                  error: sectionCountIsValid ? null : { message: 'Section count must be a positive integer.' },
                  patch: LOFT_ADVANCED_OPTION_DESCRIPTORS[0].options[0].patchTarget,
                },
              ],
            },
            {
              kind: 'optionGroup',
              id: 'loft-guide-options',
              label: 'Guide options',
              hidden: session.draft.guideCurveTargets.length === 0,
              fields: [
                {
                  kind: 'enum',
                  id: 'loft-guide-continuity',
                  label: 'Guide continuity',
                  value: guideContinuity,
                  options: [
                    { value: 'none', label: 'none' },
                    { value: 'normalToGuide', label: 'normalToGuide' },
                    { value: 'tangentToGuide', label: 'tangentToGuide' },
                    { value: 'matchTangent', label: 'matchTangent' },
                    { value: 'matchCurvature', label: 'matchCurvature' },
                  ],
                  authoredValue: {
                    expressionCapable: true,
                    valueKind: {
                      kind: 'enumString',
                      options: ['none', 'normalToGuide', 'tangentToGuide', 'matchTangent', 'matchCurvature'],
                    },
                    source: isExpressionAuthoredValue(session.draft.options.guideContinuity) ? 'expression' : 'literal',
                    expressionText: isExpressionAuthoredValue(session.draft.options.guideContinuity) ? session.draft.options.guideContinuity.valueText : null,
                  },
                  patch: LOFT_ADVANCED_OPTION_DESCRIPTORS[1].patchTarget,
                },
              ],
            },
            {
              kind: 'optionGroup',
              id: 'loft-profile-conditions',
              label: 'Profile conditions',
              fields: [
                {
                  kind: 'enum',
                  id: 'loft-start-condition',
                  label: 'Start condition',
                  value: startCondition,
                  options: [
                    { value: 'none', label: 'none' },
                    { value: 'normal', label: 'normal' },
                    { value: 'tangent', label: 'tangent' },
                  ],
                  patch: LOFT_ADVANCED_OPTION_DESCRIPTORS[2].options[0].patchTarget,
                },
                {
                  kind: 'numeric',
                  id: 'loft-start-condition-magnitude',
                  label: 'Start magnitude',
                  value: authoredNumberFormValue(profileConditions.startMagnitude ?? 1),
                  input: 'number',
                  step: 0.1,
                  hidden: startCondition === 'none',
                  authoredValue: {
                    expressionCapable: true,
                    valueKind: { kind: 'positiveNumber' },
                    source: isExpressionAuthoredValue(profileConditions.startMagnitude) ? 'expression' : 'literal',
                    expressionText: isExpressionAuthoredValue(profileConditions.startMagnitude) ? profileConditions.startMagnitude.valueText : null,
                  },
                  error: startMagnitudeIsValid ? null : { message: 'Start magnitude must be positive.' },
                  patch: LOFT_ADVANCED_OPTION_DESCRIPTORS[2].options[1].patchTarget,
                },
                {
                  kind: 'enum',
                  id: 'loft-end-condition',
                  label: 'End condition',
                  value: endCondition,
                  options: [
                    { value: 'none', label: 'none' },
                    { value: 'normal', label: 'normal' },
                    { value: 'tangent', label: 'tangent' },
                  ],
                  patch: LOFT_ADVANCED_OPTION_DESCRIPTORS[2].options[2].patchTarget,
                },
                {
                  kind: 'numeric',
                  id: 'loft-end-condition-magnitude',
                  label: 'End magnitude',
                  value: authoredNumberFormValue(profileConditions.endMagnitude ?? 1),
                  input: 'number',
                  step: 0.1,
                  hidden: endCondition === 'none',
                  authoredValue: {
                    expressionCapable: true,
                    valueKind: { kind: 'positiveNumber' },
                    source: isExpressionAuthoredValue(profileConditions.endMagnitude) ? 'expression' : 'literal',
                    expressionText: isExpressionAuthoredValue(profileConditions.endMagnitude) ? profileConditions.endMagnitude.valueText : null,
                  },
                  error: endMagnitudeIsValid ? null : { message: 'End magnitude must be positive.' },
                  patch: LOFT_ADVANCED_OPTION_DESCRIPTORS[2].options[3].patchTarget,
                },
              ],
            },
            {
              kind: 'summary',
              id: 'loft-match-connections',
              label: 'Match connections',
              value: `${session.draft.options.matchConnections?.length ?? 0}`,
              helper: 'Durable edge or vertex connection pairs are preserved for alignment.',
            },
          ],
        },
        {
          id: 'diagnostics',
          title: 'Diagnostics',
          fields: [{ kind: 'diagnostics', id: 'loft-diagnostics', label: 'Diagnostics', diagnostics }],
        },
      ],
    }
  },
} satisfies FeatureAuthoringDefinition<'loft'>
