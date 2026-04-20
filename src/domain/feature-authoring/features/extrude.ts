import type { FeatureAuthoringDefinition } from '@/domain/feature-authoring/definition'
import { getBooleanScopeBodyTargets, hasBooleanTargetScope, isBooleanOperation, toBooleanScope } from '@/domain/feature-authoring/definition'
import { createSelectionFilterForRequirement, extrudeSelectionFilter } from '@/domain/editor/schema'
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import { acceptAuthoredPatch, appendUniqueTarget, asBodyRef, asExtrudeProfileRef, authoredDefinitionValue, authoredNumberFormValue, authoredStringLiteral, createBooleanOperationFields, createMissingInputDiagnostic, expressionCapableAuthoredValue, isPositiveAuthoredNumber } from '@/domain/feature-authoring/features/shared'

function isExtrudeDirection(value: unknown): value is 'positive' | 'negative' {
  return value === 'positive' || value === 'negative'
}

export const extrudeAuthoringDefinition = {
  metadata: {
    kind: 'extrude',
    name: 'Extrude',
    tooltip: 'Create an extruded solid or surface.',
    icon: 'extrude',
    toolId: 'extrude',
    groupId: 'features',
    modes: ['part'],
  },
  featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
  selectionFilter: extrudeSelectionFilter,
  advancedParticipants: [
    {
      role: 'profile',
      label: 'Profile targets',
      required: true,
      cardinality: { min: 1, max: null },
      acceptedKinds: ['region', 'face'],
    },
    {
      role: 'targetBody',
      label: 'Boolean target bodies',
      required: false,
      cardinality: { min: 0, max: null },
      acceptedKinds: ['body'],
    },
  ],
  operationIntent: {
    supportedIntents: ['create', 'add', 'subtract', 'intersect'],
    requiredParticipantsByIntent: {
      add: ['targetBody'],
      subtract: ['targetBody'],
      intersect: ['targetBody'],
    },
  },
  createDraft(input) {
    const profileTarget = asExtrudeProfileRef(input.selectedTarget)
    return {
      profileTargets: profileTarget ? [profileTarget] : [],
      depth: 12,
      direction: 'positive',
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    }
  },
  hydrateDraft(feature) {
    return {
      profileTargets: [...feature.parameters.profiles],
      depth: feature.parameters.endExtent.distance,
      direction: feature.parameters.endExtent.direction,
      operation: feature.parameters.operation,
      booleanScope: feature.parameters.booleanScope,
    }
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      profileTargets:
        patch.profileTargets === undefined && patch.profileTarget === undefined
          ? draft.profileTargets
          : Array.isArray(patch.profileTargets)
            ? patch.profileTargets.filter((entry): entry is typeof draft.profileTargets[number] => asExtrudeProfileRef(entry as Parameters<typeof asExtrudeProfileRef>[0]) !== null)
            : asExtrudeProfileRef(patch.profileTarget as Parameters<typeof asExtrudeProfileRef>[0])
              ? [patch.profileTarget as typeof draft.profileTargets[number]]
              : draft.profileTargets,
      depth: acceptAuthoredPatch(patch.depth, draft.depth, (value): value is number => typeof value === 'number'),
      direction: isExtrudeDirection(patch.direction) ? patch.direction : draft.direction,
      operation: acceptAuthoredPatch(patch.operation, draft.operation, isBooleanOperation),
      booleanScope: toBooleanScope(patch, draft.booleanScope),
    }
  },
  applySelection(draft, target) {
    if (target.kind === 'region' || target.kind === 'face') {
      return {
        ...draft,
        profileTargets: appendUniqueTarget(draft.profileTargets, target),
      }
    }

    const bodyTarget = asBodyRef(target)
    return bodyTarget && authoredStringLiteral(draft.operation, 'newBody') !== 'newBody'
      ? this.applyPatch(draft, { booleanTargetBodyId: bodyTarget.bodyId })
      : draft
  },
  getPrimarySelectionTarget(draft) {
    return draft.profileTargets[0] ?? null
  },
  getPreviewLabel(draft, prefix) {
    return draft.profileTargets.length > 0
      ? `${prefix} extrude on ${draft.profileTargets.length} profile${draft.profileTargets.length === 1 ? '' : 's'}`
      : 'Select one or more sketch regions or planar faces for extrude'
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = []

    if (input.draft.profileTargets.length === 0) {
      diagnostics.push(createMissingInputDiagnostic({
        feature: 'extrude',
        phase: input.phase,
        suffix: 'profile',
        message: 'Select a derived sketch region or planar face before previewing extrude.',
      }))
    }

    if (!hasBooleanTargetScope(authoredStringLiteral(input.draft.operation, 'newBody'), input.draft.booleanScope)) {
      diagnostics.push(createMissingInputDiagnostic({
        feature: 'extrude',
        phase: input.phase,
        suffix: 'boolean-target',
        message: 'Select at least one target body before previewing extrude.',
      }))
    }

    return diagnostics
  },
  buildDefinition(draft) {
    const operation = authoredStringLiteral(draft.operation, 'newBody')
    return draft.profileTargets.length > 0 && hasBooleanTargetScope(operation, draft.booleanScope)
      ? {
          kind: 'extrude',
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
            profiles: draft.profileTargets as readonly [typeof draft.profileTargets[number], ...typeof draft.profileTargets[number][]],
            startExtent: { kind: 'profilePlane' },
            endExtent: {
              kind: 'blind',
              direction: draft.direction,
              distance: authoredDefinitionValue(draft.depth, 12) as number,
            },
            operation: authoredDefinitionValue(draft.operation, operation) as typeof operation,
            booleanScope: draft.booleanScope,
          },
        }
      : null
  },
  getFormSchema(session) {
    const booleanTargetBodies = getBooleanScopeBodyTargets(session.draft.booleanScope)
    const operation = authoredStringLiteral(session.draft.operation, 'newBody')
    return {
      sections: [
        {
          id: 'references',
          title: 'References',
          fields: [{
            kind: 'referenceCollection',
            id: 'extrude-profile',
            label: 'Profile targets',
            value: session.draft.profileTargets,
            emptyLabel: 'None selected',
            helper: 'Accepted targets: derived sketch regions or planar faces.',
            error: session.draft.profileTargets.length > 0 ? null : { message: 'Select at least one profile target.' },
            advancedParticipant: {
              role: 'profile',
              required: true,
              cardinality: { min: 1, max: null },
              selectedCount: session.draft.profileTargets.length,
            },
            picker: {
              mode: 'appendUnique',
              allowsMultiple: true,
              selectionFilter: createSelectionFilterForRequirement(extrudeSelectionFilter, 'extrude-profile', 'Extrude profile'),
              itemLabel: 'Profile',
            },
            patch: { patchKey: 'profileTargets' },
          }],
        },
        {
          id: 'parameters',
          title: 'Parameters',
          fields: [
            {
              kind: 'numeric',
              id: 'extrude-depth',
              label: 'Depth',
              value: authoredNumberFormValue(session.draft.depth),
              input: 'number',
              step: 0.1,
              directionToggle: {
                patch: { patchKey: 'direction' },
                value: session.draft.direction,
                forwardValue: 'positive',
                reverseValue: 'negative',
                forwardLabel: 'Positive normal',
                reverseLabel: 'Negative normal',
              },
              authoredValue: expressionCapableAuthoredValue(session.draft.depth, { kind: 'positiveNumber' }),
              error: isPositiveAuthoredNumber(session.draft.depth) ? null : { message: 'Depth must be greater than zero.' },
              patch: { patchKey: 'depth' },
            },
            ...createBooleanOperationFields({
              prefix: 'extrude',
              operation,
              operationValue: session.draft.operation,
              booleanTargetBodies,
              selectionFilter: extrudeSelectionFilter,
              selectionRequirementId: 'extrude-target-body',
              selectionRequirementLabel: 'Extrude target body',
            }),
          ],
        },
        {
          id: 'diagnostics',
          title: 'Diagnostics',
          fields: [{ kind: 'diagnostics', id: 'extrude-diagnostics', label: 'Diagnostics', diagnostics: session.diagnostics }],
        },
      ],
    }
  },
} satisfies FeatureAuthoringDefinition<'extrude'>
