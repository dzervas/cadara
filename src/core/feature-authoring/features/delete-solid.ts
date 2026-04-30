import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  validateAdvancedSolidFeatureDefinition,
} from '@/contracts/modeling/advanced-solid'
import type { DeleteSolidFeatureParameterDraft, FeatureAuthoringDefinition } from '@/core/feature-authoring/definition'
import { createSelectionFilterForRequirement, deleteSolidSelectionFilter, type PrimitiveRef } from '@/core/editor/schema'
import { appendUniqueTarget, asBodyRef, createMissingInputDiagnostic } from '@/core/feature-authoring/features/shared'

export const deleteSolidParticipants = [
  {
    role: 'body',
    label: 'Body targets',
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ['body'],
  },
] as const

function filterBodyTargets(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is Extract<PrimitiveRef, { kind: 'body' }> => asBodyRef(entry as PrimitiveRef) !== null)
    : []
}

function buildDeleteSolidDefinition(draft: DeleteSolidFeatureParameterDraft) {
  return {
    kind: 'deleteSolid' as const,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: draft.bodyTargets.length > 0
        ? [{ role: 'body' as const, targets: draft.bodyTargets }]
        : [],
    },
  }
}

function getDeleteSolidValidationDiagnostics(draft: DeleteSolidFeatureParameterDraft) {
  return validateAdvancedSolidFeatureDefinition(buildDeleteSolidDefinition(draft), {
    featureKind: 'deleteSolid',
    participants: deleteSolidParticipants,
  })
}

export const deleteSolidAuthoringDefinition = {
  metadata: {
    kind: 'deleteSolid',
    name: 'Delete Solid',
    tooltip: 'Delete one or more solid bodies from the document.',
    icon: 'deleteSolid',
    toolId: 'deleteSolid',
    groupId: 'features',
    modes: ['part'],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: deleteSolidSelectionFilter,
  advancedParticipants: deleteSolidParticipants,
  createDraft(input) {
    const selectedBody = asBodyRef(input.selectedTarget)
    return {
      bodyTargets: selectedBody ? [selectedBody] : [],
    }
  },
  hydrateDraft(feature) {
    return {
      bodyTargets: filterBodyTargets(feature.parameters.participants.find((participant) => participant.role === 'body')?.targets ?? []),
    }
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      bodyTargets:
        patch.bodyTargets === undefined
          ? draft.bodyTargets
          : filterBodyTargets(patch.bodyTargets),
    }
  },
  applySelection(draft, target) {
    const bodyTarget = asBodyRef(target)
    return bodyTarget
      ? this.applyPatch(draft, { bodyTargets: appendUniqueTarget(draft.bodyTargets, bodyTarget) })
      : draft
  },
  getPrimarySelectionTarget(draft) {
    return draft.bodyTargets[0] ?? null
  },
  getPreviewLabel(draft, prefix) {
    if (draft.bodyTargets.length === 0) {
      return 'Select one or more bodies to delete'
    }
    return `${prefix} delete-solid on ${draft.bodyTargets.length} bod${draft.bodyTargets.length === 1 ? 'y' : 'ies'}`
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getDeleteSolidValidationDiagnostics(input.draft)
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
      feature: 'deleteSolid',
      phase: input.phase,
      suffix: 'references',
      message: 'Delete-solid preview requires at least one body target.',
    })]
  },
  buildDefinition(draft) {
    return getDeleteSolidValidationDiagnostics(draft).length === 0 ? buildDeleteSolidDefinition(draft) : null
  },
  getFormSchema(session) {
    const diagnostics = session.diagnostics
    return {
      sections: [
        {
          id: 'references',
          title: 'References',
          fields: [
            {
              kind: 'referenceCollection',
              id: 'delete-solid-bodies',
              label: 'Body targets',
              value: session.draft.bodyTargets,
              emptyLabel: 'No body targets selected',
              helper: 'Select each durable body that should be removed when this feature commits.',
              error: session.draft.bodyTargets.length > 0 ? null : { message: 'Select at least one body.' },
              advancedParticipant: {
                role: 'body',
                required: true,
                cardinality: { min: 1, max: null },
                selectedCount: session.draft.bodyTargets.length,
              },
              picker: {
                mode: 'appendUnique',
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(deleteSolidSelectionFilter, 'delete-solid-body', 'Delete-solid body'),
              },
              patch: { patchKey: 'bodyTargets' },
            },
          ],
        },
        {
          id: 'diagnostics',
          title: 'Diagnostics',
          fields: [{ kind: 'diagnostics', id: 'delete-solid-diagnostics', label: 'Diagnostics', diagnostics }],
        },
      ],
    }
  },
} satisfies FeatureAuthoringDefinition<'deleteSolid'>
