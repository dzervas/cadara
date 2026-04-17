import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  validateAdvancedSolidFeatureDefinition,
  type AdvancedParticipantRole,
  type AdvancedSolidOperationIntent,
} from '@/contracts/modeling/advanced-solid'
import { primitiveRefEquals, createSelectionFilterForRequirement, loftSelectionFilter, type PrimitiveRef } from '@/domain/editor/schema'
import type { FeatureAuthoringDefinition, LoftFeatureParameterDraft } from '@/domain/feature-authoring/definition'
import {
  acceptAuthoredPatch,
  appendUniqueTarget,
  asBodyRef,
  asExtrudeProfileRef,
  asSweepPathRef,
  authoredDefinitionValue,
  authoredStringLiteral,
  createMissingInputDiagnostic,
  expressionCapableAuthoredValue,
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

function isOperationIntent(value: unknown): value is AdvancedSolidOperationIntent {
  return value === 'create' || value === 'add' || value === 'subtract' || value === 'intersect'
}

function filterTargets<TTarget extends PrimitiveRef>(
  value: unknown,
  coerce: (target: PrimitiveRef | null) => TTarget | null,
) {
  return Array.isArray(value)
    ? value.filter((entry): entry is TTarget => coerce(entry as PrimitiveRef) !== null)
    : []
}

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
  return loftParticipants
    .map((participant) => ({
      role: participant.role,
      targets: getTargetsForRole(draft, participant.role),
    }))
    .filter((participant) => participant.targets.length > 0)
}

function getLoftValidationDiagnostics(draft: LoftFeatureParameterDraft) {
  return validateAdvancedSolidFeatureDefinition({
    kind: 'loft',
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      operationIntent: authoredDefinitionValue(draft.operationIntent, 'create') as AdvancedSolidOperationIntent,
      participants: buildLoftParticipants(draft),
      ...(Object.keys(draft.options).length > 0 ? { options: draft.options } : {}),
    },
  }, {
    featureKind: 'loft',
    participants: loftParticipants,
    operationIntent: loftOperationIntent,
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
  operationIntent: loftOperationIntent,
  createDraft(input) {
    const profileTarget = asExtrudeProfileRef(input.selectedTarget)
    return {
      profileTargets: profileTarget ? [profileTarget] : [],
      guideCurveTargets: [],
      operationIntent: 'create',
      targetBodyTargets: [],
      options: {},
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
      options: feature.parameters.options ? { ...feature.parameters.options } : {},
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
      operationIntent: acceptAuthoredPatch(patch.operationIntent, draft.operationIntent, isOperationIntent),
      targetBodyTargets:
        patch.targetBodyTargets === undefined
          ? draft.targetBodyTargets
          : filterTargets(patch.targetBodyTargets, asBodyRef),
      options: patch.options && typeof patch.options === 'object' && !Array.isArray(patch.options)
        ? { ...patch.options }
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
      return diagnostics.map((diagnostic) => ({
        code: `feature-${input.phase}-${diagnostic.code}`,
        severity: input.phase === 'preview' ? 'warning' as const : 'error' as const,
        message: diagnostic.message,
        target: diagnostic.target,
        detail: {
          kind: 'advancedFeatureValidation' as const,
          diagnostic,
        },
      }))
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
            ...(Object.keys(draft.options).length > 0 ? { options: draft.options } : {}),
          },
        }
      : null
  },
  getFormSchema(session) {
    const diagnostics = session.diagnostics
    const operationIntent = authoredStringLiteral(session.draft.operationIntent, 'create')
    return {
      sections: [
        {
          id: 'references',
          title: 'References',
          fields: [
            {
              kind: 'referenceCollection',
              id: 'loft-profiles',
              label: 'Profile targets',
              value: session.draft.profileTargets,
              emptyLabel: 'None selected',
              helper: 'Accepted targets: derived sketch regions or planar faces. Order is preserved and drives the loft sections.',
              error: session.draft.profileTargets.length >= 2 ? null : { message: 'Select at least two profile targets.' },
              advancedParticipant: {
                role: 'profile',
                required: true,
                cardinality: { min: 2, max: null },
                selectedCount: session.draft.profileTargets.length,
              },
              picker: {
                mode: 'appendUnique',
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(loftSelectionFilter, 'loft-profile', 'Loft profile'),
                itemLabel: 'Profile',
              },
              patch: { patchKey: 'profileTargets' },
              ordering: {
                moveUpPatchKey: 'moveProfileTargetEarlier',
                moveDownPatchKey: 'moveProfileTargetLater',
              },
            },
            {
              kind: 'referenceCollection',
              id: 'loft-guide-curves',
              label: 'Guide curves',
              value: session.draft.guideCurveTargets,
              emptyLabel: 'None selected',
              helper: 'Guide curves are stored in the contract and reported as unsupported by the initial kernel path.',
              advancedParticipant: {
                role: 'guideCurve',
                required: false,
                cardinality: { min: 0, max: null },
                selectedCount: session.draft.guideCurveTargets.length,
              },
              picker: {
                mode: 'appendUnique',
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(loftSelectionFilter, 'loft-guide-curve', 'Loft guide curve'),
                itemLabel: 'Guide curve',
              },
              patch: { patchKey: 'guideCurveTargets' },
            },
          ],
        },
        {
          id: 'parameters',
          title: 'Parameters',
          fields: [
            {
              kind: 'enum',
              id: 'loft-operation-intent',
              label: 'Operation',
              value: operationIntent,
              options: [
                { value: 'create', label: 'create' },
                { value: 'add', label: 'add' },
                { value: 'subtract', label: 'subtract' },
                { value: 'intersect', label: 'intersect' },
              ],
              authoredValue: expressionCapableAuthoredValue(session.draft.operationIntent, { kind: 'enumString', options: ['create', 'add', 'subtract', 'intersect'] }),
              patch: { patchKey: 'operationIntent' },
            },
            {
              kind: 'referenceCollection',
              id: 'loft-target-bodies',
              label: 'Boolean target bodies',
              value: session.draft.targetBodyTargets,
              emptyLabel: 'None selected',
              helper: 'Add, subtract, and intersect require at least one explicit target body.',
              hidden: operationIntent === 'create',
              error: operationIntent === 'create' || session.draft.targetBodyTargets.length > 0
                ? null
                : { message: 'Select at least one target body.' },
              advancedParticipant: {
                role: 'targetBody',
                required: operationIntent !== 'create',
                cardinality: { min: operationIntent === 'create' ? 0 : 1, max: null },
                selectedCount: session.draft.targetBodyTargets.length,
              },
              picker: {
                mode: 'appendUnique',
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(loftSelectionFilter, 'loft-boolean-target', 'Loft target body'),
                itemLabel: 'Target body',
              },
              patch: { patchKey: 'targetBodyTargets' },
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
