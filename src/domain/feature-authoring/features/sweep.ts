import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  type AdvancedParticipantRole,
  type AdvancedSolidOperationIntent,
} from '@/contracts/modeling/advanced-solid'
import type { FeatureAuthoringDefinition, SweepFeatureParameterDraft } from '@/domain/feature-authoring/definition'
import { createSelectionFilterForRequirement, sweepSelectionFilter, type PrimitiveRef } from '@/domain/editor/schema'
import { acceptAuthoredPatch, appendUniqueTarget, asBodyRef, asExtrudeProfileRef, asSweepPathRef, authoredDefinitionValue, authoredStringLiteral, buildAdvancedSolidParticipants, createAdvancedOperationIntentFields, createMissingInputDiagnostic, createReferenceCollectionField, filterTargets, isAdvancedOperationIntent, toFeaturePhaseDiagnostics, validateAdvancedSolidDraft } from '@/domain/feature-authoring/features/shared'

const sweepParticipants = [
  {
    role: 'profile',
    label: 'Profile targets',
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ['region', 'face'],
  },
  {
    role: 'path',
    label: 'Path target',
    required: true,
    cardinality: { min: 1, max: 1 },
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

const sweepOperationIntent = {
  supportedIntents: ['create', 'add', 'subtract', 'intersect'],
  requiredParticipantsByIntent: {
    add: ['targetBody'],
    subtract: ['targetBody'],
    intersect: ['targetBody'],
  },
} as const

function getTargetsForRole(draft: SweepFeatureParameterDraft, role: AdvancedParticipantRole) {
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

function buildSweepParticipants(draft: SweepFeatureParameterDraft) {
  return buildAdvancedSolidParticipants(sweepParticipants, (role) => getTargetsForRole(draft, role))
}

function getSweepValidationDiagnostics(draft: SweepFeatureParameterDraft) {
  return validateAdvancedSolidDraft({
    featureKind: 'sweep',
    operationIntent: draft.operationIntent,
    participants: buildSweepParticipants(draft),
    participantDescriptors: sweepParticipants,
    operationIntentDescriptor: sweepOperationIntent,
    options: draft.options,
  })
}

export const sweepAuthoringDefinition = {
  metadata: {
    kind: 'sweep',
    name: 'Sweep',
    tooltip: 'Create a swept solid or surface.',
    icon: 'sweep',
    toolId: 'sweep',
    groupId: 'features',
    modes: ['part'],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: sweepSelectionFilter,
  advancedParticipants: sweepParticipants,
  operationIntent: sweepOperationIntent,
  createDraft(input) {
    const profileTarget = asExtrudeProfileRef(input.selectedTarget)
    const pathTarget = asSweepPathRef(input.selectedTarget)
    return {
      profileTargets: profileTarget ? [profileTarget] : [],
      pathTarget,
      guideCurveTargets: [],
      operationIntent: 'create',
      targetBodyTargets: [],
      options: {},
    }
  },
  hydrateDraft(feature) {
    const getParticipantTargets = (role: AdvancedParticipantRole) =>
      feature.parameters.participants.find((participant) => participant.role === role)?.targets ?? []

    const pathTargets = getParticipantTargets('path')
    return {
      profileTargets: filterTargets(getParticipantTargets('profile'), asExtrudeProfileRef),
      pathTarget: asSweepPathRef(pathTargets[0] ?? null),
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
        patch.profileTargets === undefined && patch.profileTarget === undefined
          ? draft.profileTargets
          : Array.isArray(patch.profileTargets)
            ? filterTargets(patch.profileTargets, asExtrudeProfileRef)
            : asExtrudeProfileRef(patch.profileTarget as PrimitiveRef | null)
              ? [patch.profileTarget as typeof draft.profileTargets[number]]
              : draft.profileTargets,
      pathTarget:
        patch.pathTarget === undefined ? draft.pathTarget : asSweepPathRef(patch.pathTarget as PrimitiveRef | null),
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
        ? { ...patch.options }
        : draft.options,
    }
  },
  applySelection(draft, target) {
    if (target.kind === 'region' || target.kind === 'face') {
      return {
        ...draft,
        profileTargets: appendUniqueTarget(draft.profileTargets, target),
      }
    }

    const pathTarget = asSweepPathRef(target)
    if (pathTarget && !draft.pathTarget) {
      return this.applyPatch(draft, { pathTarget })
    }

    const bodyTarget = asBodyRef(target)
    return bodyTarget && authoredStringLiteral(draft.operationIntent, 'create') !== 'create'
      ? this.applyPatch(draft, { targetBodyTargets: appendUniqueTarget(draft.targetBodyTargets, bodyTarget) })
      : draft
  },
  getPrimarySelectionTarget(draft) {
    return draft.pathTarget ?? draft.profileTargets[0] ?? draft.targetBodyTargets[0] ?? null
  },
  getPreviewLabel(draft, prefix) {
    if (draft.profileTargets.length === 0) {
      return 'Select one or more sketch regions or planar faces for sweep'
    }
    if (!draft.pathTarget) {
      return 'Select one edge or sketch entity for sweep path'
    }
    if (authoredStringLiteral(draft.operationIntent, 'create') !== 'create' && draft.targetBodyTargets.length === 0) {
      return 'Select a target body for sweep boolean operation'
    }
    return `${prefix} sweep with explicit profile and path`
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getSweepValidationDiagnostics(input.draft)
    if (diagnostics.length > 0) {
      return toFeaturePhaseDiagnostics({ phase: input.phase, diagnostics })
    }

    return [createMissingInputDiagnostic({
      feature: 'sweep',
      phase: input.phase,
      suffix: 'references',
      message: 'Sweep preview requires profile and path references.',
    })]
  },
  buildDefinition(draft) {
    return getSweepValidationDiagnostics(draft).length === 0
      ? {
          kind: 'sweep',
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            operationIntent: authoredDefinitionValue(draft.operationIntent, 'create') as AdvancedSolidOperationIntent,
            participants: buildSweepParticipants(draft),
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
              ...createReferenceCollectionField({
                id: 'sweep-profile',
                label: 'Profile targets',
                value: session.draft.profileTargets,
                helper: 'Accepted targets: derived sketch regions or planar faces.',
                error: session.draft.profileTargets.length > 0 ? null : { message: 'Select at least one profile target.' },
                participant: sweepParticipants[0],
                selectionFilter: sweepSelectionFilter,
                selectionRequirementId: 'sweep-profile',
                selectionRequirementLabel: 'Sweep profile',
                itemLabel: 'Profile',
                patchKey: 'profileTargets',
              }),
            },
            {
              kind: 'referencePicker',
              id: 'sweep-path',
              label: 'Path target',
              value: session.draft.pathTarget,
              emptyLabel: 'None selected',
              helper: 'Accepted targets: one durable edge or one sketch entity.',
              error: session.draft.pathTarget ? null : { message: 'Select a sweep path.' },
              advancedParticipant: {
                role: 'path',
                required: true,
                cardinality: { min: 1, max: 1 },
                selectedCount: session.draft.pathTarget ? 1 : 0,
              },
              picker: {
                mode: 'replace',
                allowsMultiple: false,
                selectionFilter: createSelectionFilterForRequirement(sweepSelectionFilter, 'sweep-path', 'Sweep path'),
              },
              patch: { patchKey: 'pathTarget' },
            },
            createReferenceCollectionField({
              id: 'sweep-guide-curves',
              label: 'Guide curves',
              value: session.draft.guideCurveTargets,
              helper: 'Guide curves are stored in the contract and reported as unsupported by the initial OCC builder.',
              participant: sweepParticipants[2],
              selectionFilter: sweepSelectionFilter,
              selectionRequirementId: 'sweep-guide-curve',
              selectionRequirementLabel: 'Sweep guide curve',
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
              prefix: 'sweep',
              operationIntent,
              operationValue: session.draft.operationIntent,
              targetBodyTargets: session.draft.targetBodyTargets,
              selectionFilter: sweepSelectionFilter,
              selectionRequirementId: 'sweep-boolean-target',
              selectionRequirementLabel: 'Sweep target body',
            }),
          ],
        },
        {
          id: 'diagnostics',
          title: 'Diagnostics',
          fields: [{ kind: 'diagnostics', id: 'sweep-diagnostics', label: 'Diagnostics', diagnostics }],
        },
      ],
    }
  },
} satisfies FeatureAuthoringDefinition<'sweep'>
