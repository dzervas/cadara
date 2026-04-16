import type { FeatureAuthoringDefinition } from '@/domain/feature-authoring/definition'
import { getBooleanScopeBodyTargets, hasBooleanTargetScope, isBooleanOperation, toBooleanScope } from '@/domain/feature-authoring/definition'
import { createSelectionFilterForRequirement, revolveSelectionFilter } from '@/domain/editor/schema'
import { REVOLVE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import { acceptAuthoredPatch, appendUniqueTarget, asBodyRef, asExtrudeProfileRef, asRevolveAxisRef, authoredDefinitionValue, authoredNumberFormValue, authoredStringLiteral, createMissingInputDiagnostic, isPositiveAuthoredNumber } from '@/domain/feature-authoring/features/shared'

export const revolveAuthoringDefinition = {
  metadata: {
    kind: 'revolve',
    name: 'Revolve',
    tooltip: 'Create a revolved solid or surface.',
    icon: 'revolve',
    toolId: 'revolve',
    groupId: 'features',
    modes: ['part'],
  },
  featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
  selectionFilter: revolveSelectionFilter,
  advancedParticipants: [
    {
      role: 'profile',
      label: 'Profile targets',
      required: true,
      cardinality: { min: 1, max: null },
      acceptedKinds: ['region', 'face'],
    },
    {
      role: 'axis',
      label: 'Axis target',
      required: true,
      cardinality: { min: 1, max: 1 },
      acceptedKinds: ['edge', 'construction'],
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
      axisTarget: asRevolveAxisRef(input.selectedTarget),
      startAngle: 0,
      angle: Math.PI * 2,
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    }
  },
  hydrateDraft(feature) {
    return {
      profileTargets: [...feature.parameters.profiles],
      axisTarget: feature.parameters.axis,
      startAngle: feature.parameters.startAngle,
      angle: feature.parameters.extent.radians,
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
      axisTarget:
        patch.axisTarget === undefined ? draft.axisTarget : asRevolveAxisRef(patch.axisTarget as Parameters<typeof asRevolveAxisRef>[0]),
      startAngle: acceptAuthoredPatch(patch.startAngle, draft.startAngle, (value): value is number => typeof value === 'number'),
      angle: acceptAuthoredPatch(patch.angle, draft.angle, (value): value is number => typeof value === 'number'),
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
    if (target.kind === 'edge' || target.kind === 'construction') {
      return this.applyPatch(draft, { axisTarget: target })
    }

    const bodyTarget = asBodyRef(target)
    return bodyTarget && authoredStringLiteral(draft.operation, 'newBody') !== 'newBody'
      ? this.applyPatch(draft, { booleanTargetBodyId: bodyTarget.bodyId })
      : draft
  },
  getPrimarySelectionTarget(draft) {
    return draft.axisTarget ?? draft.profileTargets[0] ?? null
  },
  getPreviewLabel(draft, prefix) {
    if (draft.profileTargets.length === 0) {
      return 'Select one or more sketch regions or planar faces for revolve'
    }
    if (!draft.axisTarget) {
      return 'Select an edge or construction axis for revolve'
    }
    return `${prefix} revolve with explicit profile and axis`
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = []

    if (input.draft.profileTargets.length === 0 || !input.draft.axisTarget) {
      diagnostics.push(createMissingInputDiagnostic({
        feature: 'revolve',
        phase: input.phase,
        suffix: 'references',
        message: 'Revolve preview requires both a profile and an axis reference.',
      }))
    }

    if (!hasBooleanTargetScope(authoredStringLiteral(input.draft.operation, 'newBody'), input.draft.booleanScope)) {
      diagnostics.push(createMissingInputDiagnostic({
        feature: 'revolve',
        phase: input.phase,
        suffix: 'boolean-target',
        message: 'Select at least one target body before previewing revolve.',
      }))
    }

    return diagnostics
  },
  buildDefinition(draft) {
    const operation = authoredStringLiteral(draft.operation, 'newBody')
    return draft.profileTargets.length > 0 && draft.axisTarget && hasBooleanTargetScope(operation, draft.booleanScope)
      ? {
          kind: 'revolve',
          featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
          parameters: {
            profiles: draft.profileTargets as readonly [typeof draft.profileTargets[number], ...typeof draft.profileTargets[number][]],
            axis: draft.axisTarget,
            startAngle: authoredDefinitionValue(draft.startAngle, 0) as number,
            extent: {
              kind: 'angle',
              direction: 'counterClockwise',
              radians: authoredDefinitionValue(draft.angle, Math.PI * 2) as number,
            },
            angle: authoredDefinitionValue(draft.angle, Math.PI * 2) as number,
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
          fields: [
            {
              kind: 'referenceCollection',
              id: 'revolve-profile',
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
                selectionFilter: createSelectionFilterForRequirement(revolveSelectionFilter, 'revolve-profile', 'Revolve profile'),
                itemLabel: 'Profile',
              },
              patch: { patchKey: 'profileTargets' },
            },
            {
              kind: 'referencePicker',
              id: 'revolve-axis',
              label: 'Axis target',
              value: session.draft.axisTarget,
              emptyLabel: 'None selected',
              helper: 'Accepted targets: one durable edge or one construction axis.',
              error: session.draft.axisTarget ? null : { message: 'Select a revolve axis.' },
              advancedParticipant: {
                role: 'axis',
                required: true,
                cardinality: { min: 1, max: 1 },
                selectedCount: session.draft.axisTarget ? 1 : 0,
              },
              picker: {
                mode: 'replace',
                allowsMultiple: false,
                selectionFilter: createSelectionFilterForRequirement(revolveSelectionFilter, 'revolve-axis', 'Revolve axis'),
              },
              patch: { patchKey: 'axisTarget' },
            },
          ],
        },
        {
          id: 'parameters',
          title: 'Parameters',
          fields: [
            { kind: 'numeric', id: 'revolve-angle', label: 'Angle (degrees)', value: authoredNumberFormValue(session.draft.angle, (value) => value * (180 / Math.PI)), input: 'angleDegrees', step: 1, authoredValue: { expressionCapable: true, valueKind: { kind: 'positiveNumber' } }, error: isPositiveAuthoredNumber(session.draft.angle) ? null : { message: 'Angle must be greater than zero.' }, patch: { patchKey: 'angle' } },
            { kind: 'numeric', id: 'revolve-start-angle', label: 'Start Angle (degrees)', value: authoredNumberFormValue(session.draft.startAngle, (value) => value * (180 / Math.PI)), input: 'angleDegrees', step: 1, authoredValue: { expressionCapable: true, valueKind: { kind: 'angle' } }, patch: { patchKey: 'startAngle' } },
            {
              kind: 'enum',
              id: 'revolve-operation',
              label: 'Operation',
              value: operation,
              options: [
                { value: 'newBody', label: 'newBody' },
                { value: 'join', label: 'join' },
                { value: 'cut', label: 'cut' },
                { value: 'intersect', label: 'intersect' },
              ],
              authoredValue: { expressionCapable: true, valueKind: { kind: 'enumString', options: ['newBody', 'join', 'cut', 'intersect'] } },
              patch: { patchKey: 'operation' },
            },
            {
              kind: 'referenceCollection',
              id: 'revolve-target-bodies',
              label: 'Boolean target bodies',
              value: booleanTargetBodies,
              emptyLabel: 'None selected',
              helper: 'Join, cut, and intersect require at least one explicit target body.',
              hidden: operation === 'newBody',
              error: operation === 'newBody' || booleanTargetBodies.length > 0
                ? null
                : { message: 'Select at least one target body.' },
              advancedParticipant: {
                role: 'targetBody',
                required: operation !== 'newBody',
                cardinality: { min: operation === 'newBody' ? 0 : 1, max: null },
                selectedCount: booleanTargetBodies.length,
              },
              picker: {
                mode: 'appendUnique',
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(revolveSelectionFilter, 'revolve-boolean-target', 'Revolve target body'),
                itemLabel: 'Target body',
              },
              patch: { patchKey: 'booleanTargetBodyIds' },
            },
          ],
        },
        {
          id: 'diagnostics',
          title: 'Diagnostics',
          fields: [{ kind: 'diagnostics', id: 'revolve-diagnostics', label: 'Diagnostics', diagnostics: session.diagnostics }],
        },
      ],
    }
  },
} satisfies FeatureAuthoringDefinition<'revolve'>
