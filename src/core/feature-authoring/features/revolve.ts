import type {
  AngularExtentDirection,
  RevolveEndCondition,
  RevolveFeatureExtent,
  UpToOffsetDirection,
} from '@/contracts/modeling/schema'
import type { FeatureAuthoringDefinition } from '@/core/feature-authoring/definition'
import { getRevolveFeatureExtent } from '@/contracts/modeling/feature-extents'
import { getBooleanScopeBodyTargets, hasBooleanTargetScope, isBooleanOperation, toBooleanScope } from '@/core/feature-authoring/definition'
import { createSelectionFilterForRequirement, revolveSelectionFilter } from '@/core/editor/schema'
import { REVOLVE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import { acceptAuthoredPatch, appendUniqueTarget, asBodyRef, asExtrudeProfileRef, asRevolveAxisRef, asUpToTargetRef, authoredDefinitionValue, authoredNumberFormValue, authoredStringLiteral, createBooleanOperationFields, createMissingInputDiagnostic, createSingleTargetSelectionFilter, expressionCapableAuthoredValue, isFiniteAuthoredNumber, isPositiveAuthoredNumber } from '@/core/feature-authoring/features/shared'
import type { FeatureEditorFormField } from '@/core/feature-authoring/form-schema'

const DEFAULT_FIRST_END: RevolveEndCondition = {
  kind: 'blind',
  direction: 'counterClockwise',
  angle: Math.PI * 2,
}

const DEFAULT_SECOND_END: Exclude<RevolveEndCondition, { kind: 'full' }> = {
  kind: 'blind',
  direction: 'clockwise',
  angle: Math.PI,
}

function isRevolveDirection(value: unknown): value is AngularExtentDirection {
  return value === 'clockwise' || value === 'counterClockwise'
}

function isExtentMode(value: unknown): value is 'oneSide' | 'symmetric' | 'twoSide' {
  return value === 'oneSide' || value === 'symmetric' || value === 'twoSide'
}

function isEndConditionKind(value: unknown): value is RevolveEndCondition['kind'] {
  return value === 'full' || value === 'blind' || value === 'upToNext' || value === 'upToFace' || value === 'upToPart' || value === 'upToVertex'
}

function isOffsetDirection(value: unknown): value is UpToOffsetDirection {
  return value === 'shorten' || value === 'extend'
}

function ensureEndSupportsMode(mode: 'oneSide' | 'symmetric' | 'twoSide', end: RevolveEndCondition): RevolveEndCondition {
  if (mode === 'symmetric' && end.kind !== 'blind') {
    return DEFAULT_FIRST_END
  }

  if (mode === 'twoSide' && end.kind === 'full') {
    return DEFAULT_FIRST_END
  }

  return end
}

function coerceTargetForEnd(kind: RevolveEndCondition['kind'], value: unknown) {
  const target = asUpToTargetRef(value as Parameters<typeof asUpToTargetRef>[0])
  if (kind === 'upToFace') {
    return target?.kind === 'face' ? target : null
  }
  if (kind === 'upToPart') {
    return target?.kind === 'body' ? target : null
  }
  if (kind === 'upToVertex') {
    return target?.kind === 'vertex' ? target : null
  }
  return null
}

function patchEnd(end: RevolveEndCondition, patch: Record<string, unknown>, prefix: 'first' | 'second'): RevolveEndCondition {
  const conditionKey = prefix === 'first' ? 'endCondition' : 'secondEndCondition'
  const directionKey = prefix === 'first' ? 'direction' : 'secondDirection'
  const angleKey = prefix === 'first' ? 'angle' : 'secondAngle'
  const targetKey = prefix === 'first' ? 'upToTarget' : 'secondUpToTarget'
  const offsetAngleKey = prefix === 'first' ? 'upToOffsetAngle' : 'secondUpToOffsetAngle'
  const offsetDirectionKey = prefix === 'first' ? 'upToOffsetDirection' : 'secondUpToOffsetDirection'
  const nextKind = isEndConditionKind(patch[conditionKey]) ? patch[conditionKey] : end.kind
  const direction = isRevolveDirection(patch[directionKey]) ? patch[directionKey] : 'direction' in end ? end.direction : 'counterClockwise'
  const offsetAngle = acceptAuthoredPatch(
    patch[offsetAngleKey],
    'offset' in end ? end.offset?.angle ?? 0 : 0,
    (value): value is number => typeof value === 'number',
  )
  const offsetDirection = isOffsetDirection(patch[offsetDirectionKey])
    ? patch[offsetDirectionKey]
    : 'offset' in end ? end.offset?.direction ?? 'shorten' : 'shorten'
  const offset = isFiniteAuthoredNumber(offsetAngle) ? { angle: offsetAngle, direction: offsetDirection } : undefined

  if (nextKind === 'full') {
    return { kind: 'full' }
  }

  if (nextKind === 'blind') {
    return {
      kind: 'blind',
      direction,
      angle: acceptAuthoredPatch(patch[angleKey], end.kind === 'blind' ? end.angle : Math.PI * 2, (value): value is number => typeof value === 'number'),
    }
  }

  if (nextKind === 'upToNext') {
    return offset ? { kind: 'upToNext', direction, offset } : { kind: 'upToNext', direction }
  }

  const target = coerceTargetForEnd(nextKind, patch[targetKey]) ?? ('target' in end ? coerceTargetForEnd(nextKind, end.target) : null)
  if (nextKind === 'upToFace') {
    return { kind: 'upToFace', direction, ...(offset ? { offset } : {}), target: target?.kind === 'face' ? target : { kind: 'face', bodyId: '' as never, faceId: '' as never } }
  }
  if (nextKind === 'upToPart') {
    return { kind: 'upToPart', direction, ...(offset ? { offset } : {}), target: target?.kind === 'body' ? target : { kind: 'body', bodyId: '' as never } }
  }
  return { kind: 'upToVertex', direction, ...(offset ? { offset } : {}), target: target?.kind === 'vertex' ? target : { kind: 'vertex', bodyId: '' as never, vertexId: '' as never } }
}

function endHasRequiredTarget(end: RevolveEndCondition) {
  if (end.kind === 'upToFace') {
    return end.target.bodyId.length > 0 && end.target.faceId.length > 0
  }
  if (end.kind === 'upToPart') {
    return end.target.bodyId.length > 0
  }
  if (end.kind === 'upToVertex') {
    return end.target.bodyId.length > 0 && end.target.vertexId.length > 0
  }
  return true
}

function endHasValidScalars(end: RevolveEndCondition) {
  return (end.kind !== 'blind' || isPositiveAuthoredNumber(end.angle))
    && (!('offset' in end) || end.offset === undefined || isFiniteAuthoredNumber(end.offset.angle))
}

function definitionEnd(end: RevolveEndCondition): RevolveEndCondition {
  switch (end.kind) {
    case 'blind':
      return { ...end, angle: authoredDefinitionValue(end.angle, Math.PI * 2) }
    case 'upToNext':
    case 'upToFace':
    case 'upToPart':
    case 'upToVertex':
      return {
        ...end,
        ...(end.offset ? { offset: { ...end.offset, angle: authoredDefinitionValue(end.offset.angle, 0) } } : {}),
      } as RevolveEndCondition
    case 'full':
      return end
  }
}

function endConditionLabel(kind: RevolveEndCondition['kind']) {
  switch (kind) {
    case 'full':
      return 'Full'
    case 'blind':
      return 'Blind'
    case 'upToNext':
      return 'Up to next'
    case 'upToFace':
      return 'Up to face'
    case 'upToPart':
      return 'Up to part'
    case 'upToVertex':
      return 'Up to vertex'
  }
}

function endFields(prefix: 'first' | 'second', end: RevolveEndCondition): FeatureEditorFormField[] {
  const idPrefix = prefix === 'first' ? 'revolve' : 'revolve-second'
  const labelPrefix = prefix === 'first' ? '' : 'Second '
  const conditionKey = prefix === 'first' ? 'endCondition' : 'secondEndCondition'
  const directionKey = prefix === 'first' ? 'direction' : 'secondDirection'
  const angleKey = prefix === 'first' ? 'angle' : 'secondAngle'
  const targetKey = prefix === 'first' ? 'upToTarget' : 'secondUpToTarget'
  const offsetAngleKey = prefix === 'first' ? 'upToOffsetAngle' : 'secondUpToOffsetAngle'
  const offsetDirectionKey = prefix === 'first' ? 'upToOffsetDirection' : 'secondUpToOffsetDirection'
  const options = prefix === 'second'
    ? ['blind', 'upToNext', 'upToFace', 'upToPart', 'upToVertex']
    : ['full', 'blind', 'upToNext', 'upToFace', 'upToPart', 'upToVertex']
  const fields: FeatureEditorFormField[] = [
    {
      kind: 'enum',
      id: `${idPrefix}-end-condition`,
      label: `${labelPrefix}End condition`,
      value: end.kind,
      options: options.map((value) => ({ value, label: endConditionLabel(value as RevolveEndCondition['kind']) })),
      patch: { patchKey: conditionKey },
    },
  ]

  if (end.kind === 'full') {
    return fields
  }

  if (end.kind === 'blind') {
    fields.push({
      kind: 'numeric',
      id: `${idPrefix}-angle`,
      label: `${labelPrefix}Angle (degrees)`,
      value: authoredNumberFormValue(end.angle, (value) => value * (180 / Math.PI)),
      input: 'angleDegrees',
      step: 1,
      directionToggle: {
        patch: { patchKey: directionKey },
        value: end.direction,
        forwardValue: 'counterClockwise',
        reverseValue: 'clockwise',
        forwardLabel: 'Counter-clockwise',
        reverseLabel: 'Clockwise',
      },
      authoredValue: expressionCapableAuthoredValue(end.angle, { kind: 'positiveNumber' }),
      error: isPositiveAuthoredNumber(end.angle) ? null : { message: 'Angle must be greater than zero.' },
      patch: { patchKey: angleKey },
    })
  } else {
    fields.push({
      kind: 'enum',
      id: `${idPrefix}-direction`,
      label: `${labelPrefix}Direction`,
      value: end.direction,
      options: [
        { value: 'counterClockwise', label: 'Counter-clockwise' },
        { value: 'clockwise', label: 'Clockwise' },
      ],
      patch: { patchKey: directionKey },
    })
  }

  if (end.kind === 'upToFace' || end.kind === 'upToPart' || end.kind === 'upToVertex') {
    const targetKind = end.kind === 'upToFace' ? 'face' : end.kind === 'upToPart' ? 'body' : 'vertex'
    fields.push({
      kind: 'referencePicker',
      id: `${idPrefix}-up-to-target`,
      label: `${labelPrefix}${endConditionLabel(end.kind)} target`,
      value: endHasRequiredTarget(end) ? end.target : null,
      emptyLabel: 'None selected',
      helper: `Accepted target: one ${targetKind}.`,
      error: endHasRequiredTarget(end) ? null : { message: `Select one ${targetKind} target.` },
      picker: {
        mode: 'replace',
        allowsMultiple: false,
        selectionFilter: createSingleTargetSelectionFilter(revolveSelectionFilter, {
          id: `${idPrefix}-up-to-target`,
          label: `${labelPrefix}${endConditionLabel(end.kind)} target`,
          targetKind,
        }),
      },
      patch: { patchKey: targetKey },
    })
  }

  if (end.kind === 'upToNext' || end.kind === 'upToFace' || end.kind === 'upToPart' || end.kind === 'upToVertex') {
    fields.push(
      {
        kind: 'numeric',
        id: `${idPrefix}-up-to-offset`,
        label: `${labelPrefix}Offset angle (degrees)`,
        value: authoredNumberFormValue(end.offset?.angle ?? 0, (value) => value * (180 / Math.PI)),
        input: 'angleDegrees',
        step: 1,
        authoredValue: expressionCapableAuthoredValue(end.offset?.angle ?? 0, { kind: 'angle' }),
        error: end.offset?.angle === undefined || isFiniteAuthoredNumber(end.offset.angle) ? null : { message: 'Offset angle must be finite.' },
        patch: { patchKey: offsetAngleKey },
      },
      {
        kind: 'enum',
        id: `${idPrefix}-up-to-offset-direction`,
        label: `${labelPrefix}Offset direction`,
        value: end.offset?.direction ?? 'shorten',
        options: [
          { value: 'shorten', label: 'Shorten' },
          { value: 'extend', label: 'Extend' },
        ],
        patch: { patchKey: offsetDirectionKey },
      },
    )
  }

  return fields
}

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
      extentMode: 'oneSide',
      firstEnd: DEFAULT_FIRST_END,
      secondEnd: DEFAULT_SECOND_END,
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    }
  },
  hydrateDraft(feature) {
    const extent = getRevolveFeatureExtent(feature.parameters)
    return {
      profileTargets: [...feature.parameters.profiles],
      axisTarget: feature.parameters.axis,
      startAngle: feature.parameters.startAngle,
      extentMode: extent.mode,
      firstEnd: extent.mode === 'twoSide' ? extent.firstEnd : extent.end,
      secondEnd: extent.mode === 'twoSide' ? extent.secondEnd : DEFAULT_SECOND_END,
      operation: feature.parameters.operation,
      booleanScope: feature.parameters.booleanScope,
    }
  },
  applyPatch(draft, patch) {
    const extentMode = isExtentMode(patch.extentMode) ? patch.extentMode : draft.extentMode
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
      extentMode,
      firstEnd: ensureEndSupportsMode(extentMode, patchEnd(draft.firstEnd, patch, 'first')),
      secondEnd: ensureEndSupportsMode('twoSide', patchEnd(draft.secondEnd, patch, 'second')) as Exclude<RevolveEndCondition, { kind: 'full' }>,
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

    if (!endHasValidScalars(input.draft.firstEnd) || !endHasRequiredTarget(input.draft.firstEnd)) {
      diagnostics.push(createMissingInputDiagnostic({
        feature: 'revolve',
        phase: input.phase,
        suffix: 'end-condition',
        message: 'Complete the active revolve end condition before previewing revolve.',
      }))
    }

    if (
      input.draft.extentMode === 'twoSide'
      && (!endHasValidScalars(input.draft.secondEnd) || !endHasRequiredTarget(input.draft.secondEnd))
    ) {
      diagnostics.push(createMissingInputDiagnostic({
        feature: 'revolve',
        phase: input.phase,
        suffix: 'second-end-condition',
        message: 'Complete the second revolve end condition before previewing revolve.',
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
    const firstEnd = ensureEndSupportsMode(draft.extentMode, draft.firstEnd)
    const extent: RevolveFeatureExtent = draft.extentMode === 'twoSide'
      ? { mode: 'twoSide', firstEnd: definitionEnd(firstEnd) as Exclude<RevolveEndCondition, { kind: 'full' }>, secondEnd: definitionEnd(draft.secondEnd) as Exclude<RevolveEndCondition, { kind: 'full' }> }
      : draft.extentMode === 'symmetric'
        ? { mode: 'symmetric', end: definitionEnd(firstEnd) as Extract<RevolveEndCondition, { kind: 'blind' }> }
        : { mode: 'oneSide', end: definitionEnd(firstEnd) }
    return draft.profileTargets.length > 0
      && draft.axisTarget
      && hasBooleanTargetScope(operation, draft.booleanScope)
      && endHasValidScalars(firstEnd)
      && endHasRequiredTarget(firstEnd)
      && (draft.extentMode !== 'twoSide' || (endHasValidScalars(draft.secondEnd) && endHasRequiredTarget(draft.secondEnd)))
      ? {
          kind: 'revolve',
          featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
          parameters: {
            profiles: draft.profileTargets as readonly [typeof draft.profileTargets[number], ...typeof draft.profileTargets[number][]],
            axis: draft.axisTarget,
            startAngle: authoredDefinitionValue(draft.startAngle, 0) as number,
            extent,
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
            {
              kind: 'enum',
              id: 'revolve-extent-mode',
              label: 'Extent mode',
              value: session.draft.extentMode,
              options: [
                { value: 'oneSide', label: 'One side' },
                { value: 'symmetric', label: 'Symmetric' },
                { value: 'twoSide', label: 'Two side' },
              ],
              patch: { patchKey: 'extentMode' },
            },
            ...endFields('first', ensureEndSupportsMode(session.draft.extentMode, session.draft.firstEnd)),
            ...(session.draft.extentMode === 'twoSide' ? endFields('second', session.draft.secondEnd) : []),
            { kind: 'numeric', id: 'revolve-start-angle', label: 'Start angle (degrees)', value: authoredNumberFormValue(session.draft.startAngle, (value) => value * (180 / Math.PI)), input: 'angleDegrees', step: 1, authoredValue: expressionCapableAuthoredValue(session.draft.startAngle, { kind: 'angle' }), patch: { patchKey: 'startAngle' } },
            ...createBooleanOperationFields({
              prefix: 'revolve',
              operation,
              operationValue: session.draft.operation,
              booleanTargetBodies,
              selectionFilter: revolveSelectionFilter,
              selectionRequirementId: 'revolve-boolean-target',
              selectionRequirementLabel: 'Revolve target body',
            }),
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
