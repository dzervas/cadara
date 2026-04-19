import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  validateAdvancedSolidFeatureDefinition,
  type AdvancedParticipantRole,
  type AdvancedSolidOperationIntent,
} from '@/contracts/modeling/advanced-solid'
import type { CombineFeatureParameterDraft, FeatureAuthoringDefinition } from '@/domain/feature-authoring/definition'
import { combineSelectionFilter, createSelectionFilterForRequirement, primitiveRefEquals, type PrimitiveRef } from '@/domain/editor/schema'
import { acceptAuthoredPatch, appendUniqueTarget, asBodyRef, authoredDefinitionValue, authoredStringLiteral, createMissingInputDiagnostic, expressionCapableAuthoredValue } from '@/domain/feature-authoring/features/shared'

export const combineParticipants = [
  {
    role: 'targetBody',
    label: 'Target bodies',
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ['body'],
  },
  {
    role: 'toolBody',
    label: 'Tool bodies',
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ['body'],
  },
] as const

export const combineOperationIntent = {
  supportedIntents: ['add', 'subtract', 'intersect'],
  requiredParticipantsByIntent: {
    add: ['targetBody', 'toolBody'],
    subtract: ['targetBody', 'toolBody'],
    intersect: ['targetBody', 'toolBody'],
  },
} as const

type CombineOperationIntent = Exclude<AdvancedSolidOperationIntent, 'create'>

function isCombineOperationIntent(value: unknown): value is CombineOperationIntent {
  return value === 'add' || value === 'subtract' || value === 'intersect'
}

function filterBodyTargets(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is Extract<PrimitiveRef, { kind: 'body' }> => asBodyRef(entry as PrimitiveRef) !== null)
    : []
}

function getTargetsForRole(draft: CombineFeatureParameterDraft, role: AdvancedParticipantRole) {
  switch (role) {
    case 'targetBody':
      return draft.targetBodyTargets
    case 'toolBody':
      return draft.toolBodyTargets
    default:
      return []
  }
}

function buildCombineParticipants(draft: CombineFeatureParameterDraft) {
  return combineParticipants
    .map((participant) => ({
      role: participant.role,
      targets: getTargetsForRole(draft, participant.role),
    }))
    .filter((participant) => participant.targets.length > 0)
}

function buildCombineDefinition(draft: CombineFeatureParameterDraft) {
  return {
    kind: 'combine' as const,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      operationIntent: authoredDefinitionValue(draft.operationIntent, 'subtract') as CombineOperationIntent,
      participants: buildCombineParticipants(draft),
    },
  }
}

function getCombineValidationDiagnostics(draft: CombineFeatureParameterDraft) {
  const diagnostics = validateAdvancedSolidFeatureDefinition(buildCombineDefinition(draft), {
    featureKind: 'combine',
    participants: combineParticipants,
    operationIntent: combineOperationIntent,
  })

  for (const targetBody of draft.targetBodyTargets) {
    if (draft.toolBodyTargets.some((toolBody) => primitiveRefEquals(toolBody, targetBody))) {
      diagnostics.push({
        code: 'advanced-feature-invalid-cardinality',
        severity: 'error',
        role: 'toolBody',
        target: targetBody,
        message: 'Combine target bodies and tool bodies must be distinct.',
      })
    }
  }

  return diagnostics
}

export const combineAuthoringDefinition = {
  metadata: {
    kind: 'combine',
    name: 'Combine',
    tooltip: 'Boolean explicit target bodies with explicit tool bodies.',
    icon: 'combine',
    toolId: 'combine',
    groupId: 'features',
    modes: ['part'],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: combineSelectionFilter,
  advancedParticipants: combineParticipants,
  operationIntent: combineOperationIntent,
  createDraft(input) {
    const bodyTarget = asBodyRef(input.selectedTarget)
    return {
      targetBodyTargets: bodyTarget ? [bodyTarget] : [],
      toolBodyTargets: [],
      operationIntent: 'subtract',
    }
  },
  hydrateDraft(feature) {
    const getParticipantTargets = (role: AdvancedParticipantRole) =>
      feature.parameters.participants.find((participant) => participant.role === role)?.targets ?? []

    const operationIntent = feature.parameters.operationIntent
    return {
      targetBodyTargets: filterBodyTargets(getParticipantTargets('targetBody')),
      toolBodyTargets: filterBodyTargets(getParticipantTargets('toolBody')),
      operationIntent: isCombineOperationIntent(operationIntent) ? operationIntent : 'subtract',
    }
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      targetBodyTargets:
        patch.targetBodyTargets === undefined
          ? draft.targetBodyTargets
          : filterBodyTargets(patch.targetBodyTargets),
      toolBodyTargets:
        patch.toolBodyTargets === undefined
          ? draft.toolBodyTargets
          : filterBodyTargets(patch.toolBodyTargets),
      operationIntent: acceptAuthoredPatch(patch.operationIntent, draft.operationIntent, isCombineOperationIntent),
    }
  },
  applySelection(draft, target) {
    const bodyTarget = asBodyRef(target)
    if (!bodyTarget) {
      return draft
    }

    if (draft.targetBodyTargets.length === 0) {
      return this.applyPatch(draft, { targetBodyTargets: [bodyTarget] })
    }

    if (!draft.targetBodyTargets.some((entry) => primitiveRefEquals(entry, bodyTarget))) {
      return this.applyPatch(draft, { toolBodyTargets: appendUniqueTarget(draft.toolBodyTargets, bodyTarget) })
    }

    return draft
  },
  getPrimarySelectionTarget(draft) {
    return draft.targetBodyTargets[0] ?? draft.toolBodyTargets[0] ?? null
  },
  getPreviewLabel(draft, prefix) {
    if (draft.targetBodyTargets.length === 0) {
      return 'Select one or more Combine target bodies'
    }
    if (draft.toolBodyTargets.length === 0) {
      return 'Select one or more Combine tool bodies'
    }
    return `${prefix} combine ${authoredStringLiteral(draft.operationIntent, 'subtract')} with explicit target and tool bodies`
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getCombineValidationDiagnostics(input.draft)
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
      feature: 'combine',
      phase: input.phase,
      suffix: 'references',
      message: 'Combine preview requires target bodies, tool bodies, and a boolean operation.',
    })]
  },
  buildDefinition(draft) {
    return getCombineValidationDiagnostics(draft).length === 0 ? buildCombineDefinition(draft) : null
  },
  getFormSchema(session) {
    const diagnostics = session.diagnostics
    const operationIntent = authoredStringLiteral(session.draft.operationIntent, 'subtract')
    return {
      sections: [
        {
          id: 'references',
          title: 'References',
          fields: [
            {
              kind: 'referenceCollection',
              id: 'combine-target-bodies',
              label: 'Target bodies',
              value: session.draft.targetBodyTargets,
              emptyLabel: 'No target bodies selected',
              helper: 'Select durable bodies that receive the boolean result.',
              error: session.draft.targetBodyTargets.length > 0 ? null : { message: 'Select at least one target body.' },
              advancedParticipant: {
                role: 'targetBody',
                required: true,
                cardinality: { min: 1, max: null },
                selectedCount: session.draft.targetBodyTargets.length,
              },
              picker: {
                mode: 'appendUnique',
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(combineSelectionFilter, 'combine-target-body', 'Combine target bodies'),
                itemLabel: 'Target body',
              },
              patch: { patchKey: 'targetBodyTargets' },
            },
            {
              kind: 'referenceCollection',
              id: 'combine-tool-bodies',
              label: 'Tool bodies',
              value: session.draft.toolBodyTargets,
              emptyLabel: 'No tool bodies selected',
              helper: 'Select durable bodies consumed as boolean tools.',
              error: session.draft.toolBodyTargets.length > 0 ? null : { message: 'Select at least one tool body.' },
              advancedParticipant: {
                role: 'toolBody',
                required: true,
                cardinality: { min: 1, max: null },
                selectedCount: session.draft.toolBodyTargets.length,
              },
              picker: {
                mode: 'appendUnique',
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(combineSelectionFilter, 'combine-tool-body', 'Combine tool bodies'),
                itemLabel: 'Tool body',
              },
              patch: { patchKey: 'toolBodyTargets' },
            },
          ],
        },
        {
          id: 'parameters',
          title: 'Parameters',
          fields: [
            {
              kind: 'enum',
              id: 'combine-operation-intent',
              label: 'Operation',
              value: operationIntent,
              options: [
                { value: 'add', label: 'add' },
                { value: 'subtract', label: 'subtract' },
                { value: 'intersect', label: 'intersect' },
              ],
              authoredValue: expressionCapableAuthoredValue(session.draft.operationIntent, { kind: 'enumString', options: ['add', 'subtract', 'intersect'] }),
              patch: { patchKey: 'operationIntent' },
            },
          ],
        },
        {
          id: 'diagnostics',
          title: 'Diagnostics',
          fields: [{ kind: 'diagnostics', id: 'combine-diagnostics', label: 'Diagnostics', diagnostics }],
        },
      ],
    }
  },
} satisfies FeatureAuthoringDefinition<'combine'>
