import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  LOFT_ADVANCED_OPTION_DESCRIPTORS,
  type AdvancedParticipantRole,
  type AdvancedSolidOperationIntent,
} from '@/contracts/modeling/advanced-solid'
import { isExpressionAuthoredValue } from '@/contracts/modeling/authored-values'
import { primitiveRefEquals, loftSelectionFilter, type PrimitiveRef } from '@/domain/editor/schema'
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
    case 'guideCurve':
      return draft.guideCurveTargets
    case 'targetBody':
      return draft.targetBodyTargets
    default:
      return []
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
      guideCurveTargets: [],
      operationIntent: 'create',
      targetBodyTargets: [],
      options: { sectionCount: 2 },
    }
  },
  hydrateDraft(feature) {
    const getParticipantTargets = (role: AdvancedParticipantRole) =>
      feature.parameters.participants.find((participant) => participant.role === role)?.targets ?? []

    return {
      profileTargets: filterTargets(getParticipantTargets('profile'), asExtrudeProfileRef),
      guideCurveTargets: filterTargets(getParticipantTargets('guideCurve'), asSweepPathRef),
      operationIntent: feature.parameters.operationIntent ?? 'create',
      targetBodyTargets: filterTargets(getParticipantTargets('targetBody'), asBodyRef),
      options: {
        sectionCount: (feature.parameters.options?.sectionCount ?? 2) as LoftFeatureParameterDraft['options']['sectionCount'],
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
        ? {
            ...draft.options,
            sectionCount: acceptAuthoredPatch(
              (patch.options as Record<string, unknown>).sectionCount,
              draft.options.sectionCount,
              (value): value is number => typeof value === 'number',
            ),
          }
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
    return draft.profileTargets[0] ?? draft.guideCurveTargets[0] ?? draft.targetBodyTargets[0] ?? null
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
    return getLoftValidationDiagnostics(draft).length === 0
      ? {
          kind: 'loft',
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            operationIntent: authoredDefinitionValue(draft.operationIntent, 'create') as AdvancedSolidOperationIntent,
            participants: buildLoftParticipants(draft),
            options: {
              sectionCount: authoredDefinitionValue(draft.options.sectionCount, 2),
            },
          },
        }
      : null
  },
  getFormSchema(session) {
    const diagnostics = session.diagnostics
    const operationIntent = authoredStringLiteral(session.draft.operationIntent, 'create')
    const sectionCount = authoredNumberLiteral(session.draft.options.sectionCount)
    const sectionCountIsValid = isExpressionAuthoredValue(session.draft.options.sectionCount)
      || (sectionCount !== null && Number.isInteger(sectionCount) && sectionCount > 0)
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
            createReferenceCollectionField({
              id: 'loft-guide-curves',
              label: 'Guide curves',
              value: session.draft.guideCurveTargets,
              helper: 'Guide curves are stored in the contract and reported as unsupported by the initial kernel path.',
              participant: loftParticipants[1],
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
              fields: [
                {
                  kind: 'numeric',
                  id: 'loft-section-count',
                  label: 'Section count',
                  value: authoredNumberFormValue(session.draft.options.sectionCount),
                  input: 'number',
                  step: 1,
                  authoredValue: {
                    expressionCapable: true,
                    valueKind: { kind: 'positiveInteger' },
                    source: isExpressionAuthoredValue(session.draft.options.sectionCount) ? 'expression' : 'literal',
                    expressionText: isExpressionAuthoredValue(session.draft.options.sectionCount) ? session.draft.options.sectionCount.valueText : null,
                  },
                  error: sectionCountIsValid ? null : { message: 'Section count must be a positive integer.' },
                  patch: LOFT_ADVANCED_OPTION_DESCRIPTORS[0].patchTarget,
                },
              ],
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
