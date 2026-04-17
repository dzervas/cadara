import type { FeatureAuthoringDefinition } from '@/domain/feature-authoring/definition'
import { createSelectionFilterForRequirement, filletSelectionFilter } from '@/domain/editor/schema'
import { FILLET_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import { acceptAuthoredPatch, appendUniqueTarget, asEdgeRef, authoredDefinitionValue, authoredNumberFormValue, createMissingInputDiagnostic, expressionCapableAuthoredValue, isPositiveAuthoredNumber } from '@/domain/feature-authoring/features/shared'

export const filletAuthoringDefinition = {
  metadata: {
    kind: 'fillet',
    name: 'Fillet',
    tooltip: 'Round selected edges.',
    icon: 'fillet',
    toolId: 'fillet',
    groupId: 'features',
    modes: ['part'],
  },
  featureTypeVersion: FILLET_FEATURE_SCHEMA_VERSION,
  selectionFilter: filletSelectionFilter,
  advancedParticipants: [
    {
      role: 'edge',
      label: 'Edge targets',
      required: true,
      cardinality: { min: 1, max: null },
      acceptedKinds: ['edge'],
    },
  ],
  createDraft(input) {
    const edgeTarget = asEdgeRef(input.selectedTarget)
    return {
      edgeTargets: edgeTarget ? [edgeTarget] : [],
      radius: 1,
    }
  },
  hydrateDraft(feature) {
    return {
      edgeTargets: [...feature.parameters.edgeTargets],
      radius: feature.parameters.radius,
    }
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      edgeTargets:
        patch.edgeTargets === undefined && patch.edgeTarget === undefined
          ? draft.edgeTargets
          : Array.isArray(patch.edgeTargets)
            ? patch.edgeTargets.filter((entry): entry is Extract<typeof draft.edgeTargets[number], { kind: 'edge' }> => entry?.kind === 'edge')
            : asEdgeRef(patch.edgeTarget as Parameters<typeof asEdgeRef>[0])
              ? [patch.edgeTarget as typeof draft.edgeTargets[number]]
              : draft.edgeTargets,
      radius: acceptAuthoredPatch(patch.radius, draft.radius, (value): value is number => typeof value === 'number'),
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
    return draft.edgeTargets.length > 0
      ? `${prefix} fillet on ${draft.edgeTargets.length} edge${draft.edgeTargets.length === 1 ? '' : 's'}`
      : 'Select one or more edges for fillet'
  },
  getMissingInputsDiagnostics(input) {
    return [createMissingInputDiagnostic({
      feature: 'fillet',
      phase: input.phase,
      suffix: 'edge',
      message: 'Fillet preview requires at least one edge target.',
    })]
  },
  buildDefinition(draft) {
    return draft.edgeTargets.length > 0
      ? {
          kind: 'fillet',
          featureTypeVersion: FILLET_FEATURE_SCHEMA_VERSION,
          parameters: {
            edgeTargets: draft.edgeTargets,
            radius: authoredDefinitionValue(draft.radius, 1) as number,
          },
        }
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
            id: 'fillet-edges',
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
              selectionFilter: createSelectionFilterForRequirement(filletSelectionFilter, 'fillet-edge', 'Fillet edges'),
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
            id: 'fillet-radius',
            label: 'Radius',
            value: authoredNumberFormValue(session.draft.radius),
            input: 'number',
            step: 0.1,
            authoredValue: expressionCapableAuthoredValue(session.draft.radius, { kind: 'positiveNumber' }),
            error: isPositiveAuthoredNumber(session.draft.radius) ? null : { message: 'Radius must be greater than zero.' },
            patch: { patchKey: 'radius' },
          }],
        },
        {
          id: 'diagnostics',
          title: 'Diagnostics',
          fields: [{ kind: 'diagnostics', id: 'fillet-diagnostics', label: 'Diagnostics', diagnostics: session.diagnostics }],
        },
      ],
    }
  },
} satisfies FeatureAuthoringDefinition<'fillet'>
