import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  validateAdvancedSolidFeatureDefinition,
} from '@/contracts/modeling/advanced-solid'
import type { FeatureAuthoringDefinition, MirrorFeatureParameterDraft } from '@/core/feature-authoring/definition'
import { createSelectionFilterForRequirement, mirrorSelectionFilter, type PrimitiveRef } from '@/core/editor/schema'
import {
  acceptAuthoredPatch,
  appendUniqueTarget,
  asBodyRef,
  asPlaneReferenceTarget,
  authoredDefinitionValue,
  authoredBooleanLiteral,
  createMissingInputDiagnostic,
} from '@/core/feature-authoring/features/shared'

export const mirrorParticipants = [
  {
    role: 'body',
    label: 'Body targets',
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ['body'],
  },
  {
    role: 'plane',
    label: 'Mirror plane',
    required: true,
    cardinality: { min: 1, max: 1 },
    acceptedKinds: ['construction', 'face'],
  },
] as const

export const mirrorOptions = [
  {
    key: 'copy',
    label: 'Copy bodies',
    required: true,
    valueKind: 'boolean',
  },
] as const

function filterBodyTargets(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is Extract<PrimitiveRef, { kind: 'body' }> => asBodyRef(entry as PrimitiveRef) !== null)
    : []
}

function buildMirrorDefinition(draft: MirrorFeatureParameterDraft) {
  return {
    kind: 'mirror' as const,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        ...(draft.bodyTargets.length > 0 ? [{ role: 'body' as const, targets: draft.bodyTargets }] : []),
        ...(draft.planeTarget ? [{ role: 'plane' as const, targets: [draft.planeTarget] }] : []),
      ],
      options: {
        copy: authoredDefinitionValue(draft.copy, true),
      },
    },
  }
}

function getMirrorValidationDiagnostics(draft: MirrorFeatureParameterDraft) {
  return validateAdvancedSolidFeatureDefinition(buildMirrorDefinition(draft), {
    featureKind: 'mirror',
    participants: mirrorParticipants,
    options: mirrorOptions,
  })
}

export const mirrorAuthoringDefinition = {
  metadata: {
    kind: 'mirror',
    name: 'Mirror',
    tooltip: 'Mirror selected bodies across an explicit plane reference.',
    icon: 'mirror',
    toolId: 'mirror',
    groupId: 'transforms',
    modes: ['part'],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: mirrorSelectionFilter,
  advancedParticipants: mirrorParticipants,
  createDraft(input) {
    const selectedBody = asBodyRef(input.selectedTarget)
    const selectedPlane = asPlaneReferenceTarget(input.selectedTarget)
    return {
      bodyTargets: selectedBody ? [selectedBody] : [],
      planeTarget: selectedPlane,
      copy: true,
    }
  },
  hydrateDraft(feature) {
    const planeTarget = asPlaneReferenceTarget(feature.parameters.participants.find((participant) => participant.role === 'plane')?.targets[0] ?? null)
    return {
      bodyTargets: filterBodyTargets(feature.parameters.participants.find((participant) => participant.role === 'body')?.targets ?? []),
      planeTarget,
      copy: (feature.parameters.options?.copy ?? true) as MirrorFeatureParameterDraft['copy'],
    }
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      bodyTargets:
        patch.bodyTargets === undefined
          ? draft.bodyTargets
          : filterBodyTargets(patch.bodyTargets),
      planeTarget:
        patch.planeTarget === undefined
          ? draft.planeTarget
          : asPlaneReferenceTarget(patch.planeTarget as PrimitiveRef | null),
      copy:
        patch.copyMode === 'copy'
          ? true
          : patch.copyMode === 'replace'
            ? false
            : typeof patch.copy === 'boolean'
              ? patch.copy
              : patch.copyMode && typeof patch.copyMode === 'object'
                ? acceptAuthoredPatch(patch.copyMode, draft.copy, (value): value is boolean => typeof value === 'boolean')
              : draft.copy,
    }
  },
  applySelection(draft, target) {
    const bodyTarget = asBodyRef(target)
    if (bodyTarget) {
      return this.applyPatch(draft, { bodyTargets: appendUniqueTarget(draft.bodyTargets, bodyTarget) })
    }

    const planeTarget = asPlaneReferenceTarget(target)
    return planeTarget ? this.applyPatch(draft, { planeTarget }) : draft
  },
  getPrimarySelectionTarget(draft) {
    return draft.bodyTargets[0] ?? draft.planeTarget ?? null
  },
  getPreviewLabel(draft, prefix) {
    if (draft.bodyTargets.length === 0) {
      return 'Select one or more bodies to mirror'
    }
    if (!draft.planeTarget) {
      return 'Select one mirror plane'
    }
    if (!authoredBooleanLiteral(draft.copy, true)) {
      return 'Mirror replace is defined but not supported in the first slice'
    }
    return `${prefix} mirror on ${draft.bodyTargets.length} bod${draft.bodyTargets.length === 1 ? 'y' : 'ies'}`
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getMirrorValidationDiagnostics(input.draft)
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
      feature: 'mirror',
      phase: input.phase,
      suffix: 'references',
      message: 'Mirror preview requires body targets, one explicit mirror plane, and copy mode.',
    })]
  },
  buildDefinition(draft) {
    return getMirrorValidationDiagnostics(draft).length === 0 ? buildMirrorDefinition(draft) : null
  },
  getFormSchema(session) {
    return {
      sections: [
        {
          id: 'references',
          title: 'References',
          fields: [
            {
              kind: 'referenceCollection',
              id: 'mirror-bodies',
              label: 'Body targets',
              value: session.draft.bodyTargets,
              emptyLabel: 'No body targets selected',
              helper: 'Select each explicit durable body that should be mirrored.',
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
                selectionFilter: createSelectionFilterForRequirement(mirrorSelectionFilter, 'mirror-body', 'Mirror bodies'),
                itemLabel: 'Body',
              },
              patch: { patchKey: 'bodyTargets' },
            },
            {
              kind: 'referencePicker',
              id: 'mirror-plane',
              label: 'Mirror plane',
              value: session.draft.planeTarget,
              emptyLabel: 'No mirror plane selected',
              helper: 'Select one explicit planar face or construction plane.',
              error: session.draft.planeTarget ? null : { message: 'Select one mirror plane.' },
              advancedParticipant: {
                role: 'plane',
                required: true,
                cardinality: { min: 1, max: 1 },
                selectedCount: session.draft.planeTarget ? 1 : 0,
              },
              picker: {
                mode: 'replace',
                allowsMultiple: false,
                selectionFilter: createSelectionFilterForRequirement(mirrorSelectionFilter, 'mirror-plane', 'Mirror plane'),
              },
              patch: { patchKey: 'planeTarget' },
            },
          ],
        },
        {
          id: 'parameters',
          title: 'Parameters',
          fields: [
            {
              kind: 'enum',
              id: 'mirror-copy-mode',
              label: 'Result policy',
              value: authoredBooleanLiteral(session.draft.copy, true) ? 'copy' : 'replace',
              options: [
                { value: 'copy', label: 'copy' },
                { value: 'replace', label: 'replace' },
              ],
              helper: 'Replace is preserved in the draft contract shape but remains unsupported by the first adapter slice.',
              patch: { patchKey: 'copyMode' },
            },
          ],
        },
        {
          id: 'diagnostics',
          title: 'Diagnostics',
          fields: [{ kind: 'diagnostics', id: 'mirror-diagnostics', label: 'Diagnostics', diagnostics: session.diagnostics }],
        },
      ],
    }
  },
} satisfies FeatureAuthoringDefinition<'mirror'>
