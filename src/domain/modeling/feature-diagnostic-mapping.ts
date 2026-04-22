import type { AuthoredFeatureRecord } from '@/contracts/modeling/authored-document'
import type { FeatureDefinition, ModelingDiagnostic } from '@/contracts/modeling/schema'
import type { FeatureId } from '@/contracts/shared/ids'
import type { DurableRef } from '@/contracts/shared/references'
import { getPrimitiveRefKey } from '@/domain/editor/schema'
import { getExtrudeFeatureExtent, getRevolveFeatureExtent } from '@/contracts/modeling/feature-extents'

interface FeatureFieldAttribution {
  fieldId: string
  fieldPath: readonly (string | number)[]
  label: string
}

function capitalize(value: string) {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}

type DiagnosticFeatureRecord = Pick<AuthoredFeatureRecord, 'featureId' | 'definition'> & { label?: string }

function featureLabel(feature: DiagnosticFeatureRecord) {
  return feature.label || `${capitalize(feature.definition.kind)} feature`
}

function targetMatches(left: DurableRef, right: DurableRef) {
  return getPrimitiveRefKey(left) === getPrimitiveRefKey(right)
}

function includesTarget(targets: readonly DurableRef[], target: DurableRef) {
  return targets.some((entry) => targetMatches(entry, target))
}

function getExtrudeEndTargets(definition: Extract<FeatureDefinition, { kind: 'extrude' }>) {
  const extent = getExtrudeFeatureExtent(definition.parameters)
  const ends = extent.mode === 'twoSide' ? [extent.firstEnd, extent.secondEnd] : [extent.end]
  return ends.flatMap((end) => 'target' in end ? [end.target] : [])
}

function getRevolveEndTargets(definition: Extract<FeatureDefinition, { kind: 'revolve' }>) {
  const extent = getRevolveFeatureExtent(definition.parameters)
  const ends = extent.mode === 'twoSide' ? [extent.firstEnd, extent.secondEnd] : [extent.end]
  return ends.flatMap((end) => 'target' in end ? [end.target] : [])
}

function scopeContainsTarget(
  scope: Extract<FeatureDefinition, { kind: 'extrude' | 'revolve' | 'shell' }>['parameters']['booleanScope'],
  target: DurableRef,
) {
  if (target.kind !== 'body') {
    return false
  }

  if (scope.kind === 'targetBody') {
    return scope.bodyId === target.bodyId
  }

  return scope.kind === 'targetBodies' && scope.bodyIds.includes(target.bodyId)
}

function advancedParticipantField(definition: FeatureDefinition, target: DurableRef): FeatureFieldAttribution | null {
  if (
    definition.kind === 'extrude'
    || definition.kind === 'fillet'
    || definition.kind === 'plane'
    || definition.kind === 'revolve'
    || definition.kind === 'shell'
    || definition.kind === 'stepImport'
    || definition.kind === 'meshImport'
  ) {
    return null
  }

  const participantIndex = definition.parameters.participants.findIndex((participant) =>
    includesTarget(participant.targets, target),
  )
  const participant = participantIndex >= 0 ? definition.parameters.participants[participantIndex] : null

  return participant
    ? {
        fieldId: `participants.${participant.role}`,
        fieldPath: ['parameters', 'participants', participantIndex, 'targets'],
        label: `${participant.role} selection`,
      }
    : null
}

export function getFeatureFieldAttribution(
  definition: FeatureDefinition,
  target: DurableRef | null,
): FeatureFieldAttribution {
  if (!target) {
    return {
      fieldId: 'definition',
      fieldPath: ['definition'],
      label: 'definition',
    }
  }

  switch (definition.kind) {
    case 'extrude':
      if (includesTarget(definition.parameters.profiles, target)) {
        return { fieldId: 'profiles', fieldPath: ['parameters', 'profiles'], label: 'profile selection' }
      }
      if (includesTarget(getExtrudeEndTargets(definition), target)) {
        return { fieldId: 'endExtent', fieldPath: ['parameters', 'endExtent'], label: 'end condition target' }
      }
      if (scopeContainsTarget(definition.parameters.booleanScope, target)) {
        return { fieldId: 'booleanScope', fieldPath: ['parameters', 'booleanScope'], label: 'boolean target' }
      }
      break
    case 'fillet':
      if (includesTarget(definition.parameters.edgeTargets, target)) {
        return { fieldId: 'edgeTargets', fieldPath: ['parameters', 'edgeTargets'], label: 'edge selection' }
      }
      break
    case 'plane':
      return { fieldId: 'reference', fieldPath: ['parameters', 'reference', 'target'], label: 'reference target' }
    case 'revolve':
      if (includesTarget(definition.parameters.profiles, target)) {
        return { fieldId: 'profiles', fieldPath: ['parameters', 'profiles'], label: 'profile selection' }
      }
      if (targetMatches(definition.parameters.axis, target)) {
        return { fieldId: 'axis', fieldPath: ['parameters', 'axis'], label: 'axis selection' }
      }
      if (includesTarget(getRevolveEndTargets(definition), target)) {
        return { fieldId: 'endExtent', fieldPath: ['parameters', 'endExtent'], label: 'end condition target' }
      }
      if (scopeContainsTarget(definition.parameters.booleanScope, target)) {
        return { fieldId: 'booleanScope', fieldPath: ['parameters', 'booleanScope'], label: 'boolean target' }
      }
      break
    case 'shell':
      if (targetMatches(definition.parameters.bodyTarget, target)) {
        return { fieldId: 'bodyTarget', fieldPath: ['parameters', 'bodyTarget'], label: 'body selection' }
      }
      if (includesTarget(definition.parameters.faceTargets, target)) {
        return { fieldId: 'faceTargets', fieldPath: ['parameters', 'faceTargets'], label: 'face selection' }
      }
      if (scopeContainsTarget(definition.parameters.booleanScope, target)) {
        return { fieldId: 'booleanScope', fieldPath: ['parameters', 'booleanScope'], label: 'boolean target' }
      }
      break
    default: {
      const advancedField = advancedParticipantField(definition, target)
      if (advancedField) {
        return advancedField
      }
    }
  }

  return {
    fieldId: 'definition',
    fieldPath: ['definition'],
    label: 'definition',
  }
}

export function createFeatureFieldDiagnostic(input: {
  code: string
  feature: DiagnosticFeatureRecord
  severity?: ModelingDiagnostic['severity']
  target: DurableRef | null
  detail: ModelingDiagnostic['detail']
}): ModelingDiagnostic {
  const field = getFeatureFieldAttribution(input.feature.definition, input.target)
  const label = featureLabel(input.feature)

  return {
    code: input.code,
    severity: input.severity ?? 'error',
    message: `${label} ${field.label} is incorrect.`,
    featureId: input.feature.featureId,
    fieldId: field.fieldId,
    fieldPath: field.fieldPath,
    repairGuidance: `Edit ${label} and choose a valid ${field.label}.`,
    target: input.target,
    detail: input.detail,
  }
}

export function createDependencyBlockedDiagnostic(input: {
  featureId: FeatureId
  featureLabel: string
  blockingFeatureId: FeatureId
  blockingFeatureLabel: string
}): ModelingDiagnostic {
  return {
    code: 'feature-dependency-blocked',
    severity: 'error',
    message: `${input.featureLabel} is blocked by an earlier feature error.`,
    featureId: input.featureId,
    fieldId: 'dependency',
    fieldPath: ['dependency'],
    repairGuidance: `Repair ${input.blockingFeatureLabel}, then rebuild ${input.featureLabel}.`,
    target: { kind: 'feature', featureId: input.featureId },
    detail: {
      kind: 'rebuildFailure',
      affectedFeatureIds: [input.blockingFeatureId, input.featureId],
      affectedTargets: [{ kind: 'feature', featureId: input.featureId }],
    },
  }
}
