import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  validateAdvancedSolidFeatureDefinition,
} from '@/contracts/modeling/advanced-solid'
import type { ChamferFeatureParameterDraft, FeatureAuthoringDefinition } from '@/core/feature-authoring/definition'
import { chamferSelectionFilter, createSelectionFilterForRequirement, type PrimitiveRef } from '@/core/editor/schema'
import { acceptAuthoredPatch, appendUniqueTarget, asEdgeRef, authoredDefinitionValue, authoredNumberFormValue, authoredNumberLiteral, createMissingInputDiagnostic, expressionCapableAuthoredValue, isPositiveAuthoredNumber } from '@/core/feature-authoring/features/shared'

export const chamferParticipants = [
  {
    role: 'edge',
    label: 'Edge targets',
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ['edge'],
  },
] as const

export const chamferOptions = [
  {
    key: 'distance',
    label: 'Distance',
    required: true,
    valueKind: 'positiveNumber',
  },
] as const

function filterEdgeTargets(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is Extract<PrimitiveRef, { kind: 'edge' }> => asEdgeRef(entry as PrimitiveRef | null) !== null)
    : []
}

function buildChamferDefinition(draft: ChamferFeatureParameterDraft) {
  return {
    kind: 'chamfer' as const,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        { role: 'edge' as const, targets: draft.edgeTargets },
      ],
      options: { distance: authoredDefinitionValue(draft.distance, 1) },
    },
  }
}

function getChamferValidationDiagnostics(draft: ChamferFeatureParameterDraft) {
  return validateAdvancedSolidFeatureDefinition(buildChamferDefinition(draft), {
    featureKind: 'chamfer',
    participants: chamferParticipants,
    options: chamferOptions,
  })
}

export const chamferAuthoringDefinition = {
  metadata: {
    kind: 'chamfer',
    name: 'Chamfer',
    tooltip: 'Bevel selected edges.',
    icon: 'chamfer',
    toolId: 'chamfer',
    groupId: 'features',
    modes: ['part'],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: chamferSelectionFilter,
  advancedParticipants: chamferParticipants,
  createDraft(input) {
    const edgeTarget = asEdgeRef(input.selectedTarget)
    return {
      edgeTargets: edgeTarget ? [edgeTarget] : [],
      distance: 1,
    }
  },
  hydrateDraft(feature) {
    const edgeTargets = feature.parameters.participants.find((participant) => participant.role === 'edge')?.targets ?? []
    const distance = feature.parameters.options?.distance
    return {
      edgeTargets: filterEdgeTargets(edgeTargets),
      distance: (distance ?? 1) as ChamferFeatureParameterDraft['distance'],
    }
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      edgeTargets:
        patch.edgeTargets === undefined && patch.edgeTarget === undefined
          ? draft.edgeTargets
          : Array.isArray(patch.edgeTargets)
            ? filterEdgeTargets(patch.edgeTargets)
            : asEdgeRef(patch.edgeTarget as PrimitiveRef | null)
              ? [patch.edgeTarget as typeof draft.edgeTargets[number]]
              : draft.edgeTargets,
      distance: acceptAuthoredPatch(patch.distance, draft.distance, (value): value is number => typeof value === 'number'),
    }
  },
  applySelection(draft, target) {
    return target.kind === 'edge'
      ? {
          ...draft,
          edgeTargets: appendUniqueTarget(draft.edgeTargets, target),
        }
      : draft
  },
  getPrimarySelectionTarget(draft) {
    return draft.edgeTargets[0] ?? null
  },
  getPreviewLabel(draft, prefix) {
    if (draft.edgeTargets.length === 0) {
      return 'Select one or more edges for chamfer'
    }
    const distance = authoredNumberLiteral(draft.distance)
    if (distance !== null && distance <= 0) {
      return 'Enter a positive chamfer distance'
    }
    return `${prefix} chamfer on ${draft.edgeTargets.length} edge${draft.edgeTargets.length === 1 ? '' : 's'}`
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getChamferValidationDiagnostics(input.draft)
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
      feature: 'chamfer',
      phase: input.phase,
      suffix: 'edge',
      message: 'Chamfer preview requires at least one edge target.',
    })]
  },
  buildDefinition(draft) {
    return getChamferValidationDiagnostics(draft).length === 0
      ? buildChamferDefinition(draft)
      : null
  },
  getFormSchema(session) {
    return {
      sections: [
        {
          id: 'references',
          title: 'References',
          fields: [{
            kind: 'referenceCollection',
            id: 'chamfer-edges',
            label: 'Edge targets',
            value: session.draft.edgeTargets,
            emptyLabel: 'None selected',
            helper: 'Each selected durable edge is preserved explicitly in the draft.',
            error: session.draft.edgeTargets.length > 0 ? null : { message: 'Select at least one edge target.' },
            advancedParticipant: {
              role: 'edge',
              required: true,
              cardinality: { min: 1, max: null },
              selectedCount: session.draft.edgeTargets.length,
            },
            picker: {
              mode: 'appendUnique',
              allowsMultiple: true,
              selectionFilter: createSelectionFilterForRequirement(chamferSelectionFilter, 'chamfer-edge', 'Chamfer edges'),
              itemLabel: 'Edge',
            },
            patch: { patchKey: 'edgeTargets' },
          }],
        },
        {
          id: 'parameters',
          title: 'Parameters',
          fields: [{
            kind: 'numeric',
            id: 'chamfer-distance',
            label: 'Distance',
            value: authoredNumberFormValue(session.draft.distance),
            input: 'number',
            step: 0.1,
            authoredValue: expressionCapableAuthoredValue(session.draft.distance, { kind: 'positiveNumber' }),
            error: isPositiveAuthoredNumber(session.draft.distance)
              ? null
              : { message: 'Distance must be greater than zero.' },
            patch: { patchKey: 'distance' },
          }],
        },
        {
          id: 'diagnostics',
          title: 'Diagnostics',
          fields: [{ kind: 'diagnostics', id: 'chamfer-diagnostics', label: 'Diagnostics', diagnostics: session.diagnostics }],
        },
      ],
    }
  },
} satisfies FeatureAuthoringDefinition<'chamfer'>
