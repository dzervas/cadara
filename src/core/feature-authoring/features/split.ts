import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  validateAdvancedSolidFeatureDefinition,
} from '@/contracts/modeling/advanced-solid'
import type { FeatureAuthoringDefinition, SplitFeatureParameterDraft } from '@/core/feature-authoring/definition'
import { createSelectionFilterForRequirement, splitSelectionFilter, type PrimitiveRef } from '@/core/editor/schema'
import { asBodyRef, createMissingInputDiagnostic } from '@/core/feature-authoring/features/shared'

export const splitParticipants = [
  {
    role: 'targetBody',
    label: 'Target body',
    required: true,
    cardinality: { min: 1, max: 1 },
    acceptedKinds: ['body'],
  },
  {
    role: 'toolBody',
    label: 'Split tool body',
    required: true,
    cardinality: { min: 1, max: 1 },
    acceptedKinds: ['body'],
  },
] as const

function buildSplitDefinition(draft: SplitFeatureParameterDraft) {
  return {
    kind: 'split' as const,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        ...(draft.targetBodyTarget ? [{ role: 'targetBody' as const, targets: [draft.targetBodyTarget] }] : []),
        ...(draft.toolBodyTarget ? [{ role: 'toolBody' as const, targets: [draft.toolBodyTarget] }] : []),
      ],
    },
  }
}

function getSplitValidationDiagnostics(draft: SplitFeatureParameterDraft) {
  return validateAdvancedSolidFeatureDefinition(buildSplitDefinition(draft), {
    featureKind: 'split',
    participants: splitParticipants,
  })
}

export const splitAuthoringDefinition = {
  metadata: {
    kind: 'split',
    name: 'Split',
    tooltip: 'Split one solid body with another solid tool body.',
    icon: 'split',
    toolId: 'split',
    groupId: 'features',
    modes: ['part'],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: splitSelectionFilter,
  advancedParticipants: splitParticipants,
  createDraft(input) {
    return {
      targetBodyTarget: asBodyRef(input.selectedTarget),
      toolBodyTarget: null,
    }
  },
  hydrateDraft(feature) {
    const getParticipantTarget = (role: 'targetBody' | 'toolBody') =>
      asBodyRef(feature.parameters.participants.find((participant) => participant.role === role)?.targets[0] ?? null)

    return {
      targetBodyTarget: getParticipantTarget('targetBody'),
      toolBodyTarget: getParticipantTarget('toolBody'),
    }
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      targetBodyTarget:
        patch.targetBodyTarget === undefined ? draft.targetBodyTarget : asBodyRef(patch.targetBodyTarget as PrimitiveRef | null),
      toolBodyTarget:
        patch.toolBodyTarget === undefined ? draft.toolBodyTarget : asBodyRef(patch.toolBodyTarget as PrimitiveRef | null),
    }
  },
  applySelection(draft, target) {
    const bodyTarget = asBodyRef(target)
    if (!bodyTarget) {
      return draft
    }

    if (!draft.targetBodyTarget) {
      return this.applyPatch(draft, { targetBodyTarget: bodyTarget })
    }

    if (!draft.toolBodyTarget && draft.targetBodyTarget.bodyId !== bodyTarget.bodyId) {
      return this.applyPatch(draft, { toolBodyTarget: bodyTarget })
    }

    return draft
  },
  getPrimarySelectionTarget(draft) {
    return draft.targetBodyTarget ?? draft.toolBodyTarget ?? null
  },
  getPreviewLabel(draft, prefix) {
    if (!draft.targetBodyTarget) {
      return 'Select one body to split'
    }
    if (!draft.toolBodyTarget) {
      return 'Select one body to use as the split tool'
    }
    return `${prefix} split between two explicit bodies`
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getSplitValidationDiagnostics(input.draft)
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
      feature: 'split',
      phase: input.phase,
      suffix: 'references',
      message: 'Split preview requires one target body and one split tool body.',
    })]
  },
  buildDefinition(draft) {
    return getSplitValidationDiagnostics(draft).length === 0 ? buildSplitDefinition(draft) : null
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
              kind: 'referencePicker',
              id: 'split-target-body',
              label: 'Target body',
              value: session.draft.targetBodyTarget,
              emptyLabel: 'No target body selected',
              helper: 'Select the durable body that should be split.',
              error: session.draft.targetBodyTarget ? null : { message: 'Select one target body.' },
              advancedParticipant: {
                role: 'targetBody',
                required: true,
                cardinality: { min: 1, max: 1 },
                selectedCount: session.draft.targetBodyTarget ? 1 : 0,
              },
              picker: {
                mode: 'replace',
                allowsMultiple: false,
                selectionFilter: createSelectionFilterForRequirement(splitSelectionFilter, 'split-target-body', 'Split target body'),
              },
              patch: { patchKey: 'targetBodyTarget' },
            },
            {
              kind: 'referencePicker',
              id: 'split-tool-body',
              label: 'Split tool body',
              value: session.draft.toolBodyTarget,
              emptyLabel: 'No split tool body selected',
              helper: 'Select the durable body used to cut the target into separate result bodies.',
              error: session.draft.toolBodyTarget ? null : { message: 'Select one split tool body.' },
              advancedParticipant: {
                role: 'toolBody',
                required: true,
                cardinality: { min: 1, max: 1 },
                selectedCount: session.draft.toolBodyTarget ? 1 : 0,
              },
              picker: {
                mode: 'replace',
                allowsMultiple: false,
                selectionFilter: createSelectionFilterForRequirement(splitSelectionFilter, 'split-tool-body', 'Split tool body'),
              },
              patch: { patchKey: 'toolBodyTarget' },
            },
          ],
        },
        {
          id: 'diagnostics',
          title: 'Diagnostics',
          fields: [{ kind: 'diagnostics', id: 'split-diagnostics', label: 'Diagnostics', diagnostics }],
        },
      ],
    }
  },
} satisfies FeatureAuthoringDefinition<'split'>
