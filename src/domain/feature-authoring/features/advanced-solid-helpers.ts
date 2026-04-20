import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  validateAdvancedSolidFeatureDefinition,
  type AdvancedFeatureValidationDiagnostic,
  type AdvancedParticipantRole,
  type AdvancedSolidOperationIntent,
} from '@/contracts/modeling/advanced-solid'
import type { MaybeAuthoredValue } from '@/contracts/modeling/authored-values'
import type {
  AdvancedOperationIntentDescriptor,
  AdvancedParticipantDescriptor,
  AuthoredFeatureKind,
} from '@/contracts/modeling/schema'
import type { DurableRef } from '@/contracts/shared/references'
import { authoredDefinitionValue } from '@/domain/feature-authoring/features/authored-value-helpers'

export function isAdvancedOperationIntent(value: unknown): value is AdvancedSolidOperationIntent {
  return value === 'create' || value === 'add' || value === 'subtract' || value === 'intersect'
}

export function buildAdvancedSolidParticipants(
  participants: readonly AdvancedParticipantDescriptor[],
  getTargetsForRole: (role: AdvancedParticipantRole) => readonly DurableRef[],
) {
  return participants
    .map((participant) => ({
      role: participant.role,
      targets: getTargetsForRole(participant.role),
    }))
    .filter((participant) => participant.targets.length > 0)
}

export function validateAdvancedSolidDraft(input: {
  featureKind: Extract<AuthoredFeatureKind, 'sweep' | 'loft' | 'chamfer' | 'thicken' | 'combine' | 'split' | 'deleteSolid' | 'mirror' | 'transform'>
  operationIntent: MaybeAuthoredValue<AdvancedSolidOperationIntent>
  participants: readonly ReturnType<typeof buildAdvancedSolidParticipants>[number][]
  participantDescriptors: readonly AdvancedParticipantDescriptor[]
  operationIntentDescriptor: AdvancedOperationIntentDescriptor
  options: Record<string, unknown>
}) {
  return validateAdvancedSolidFeatureDefinition({
    kind: input.featureKind,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      operationIntent: authoredDefinitionValue(input.operationIntent, 'create') as AdvancedSolidOperationIntent,
      participants: input.participants,
      ...(Object.keys(input.options).length > 0 ? { options: input.options } : {}),
    },
  }, {
    featureKind: input.featureKind,
    participants: input.participantDescriptors,
    operationIntent: input.operationIntentDescriptor,
  })
}

export function toFeaturePhaseDiagnostics(input: {
  phase: 'preview' | 'commit'
  diagnostics: readonly AdvancedFeatureValidationDiagnostic[]
}) {
  return input.diagnostics.map((diagnostic) => ({
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

