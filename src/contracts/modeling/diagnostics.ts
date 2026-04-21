import type { FeatureId } from '@/contracts/shared/ids'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'

export type FeatureScopedModelingDiagnostic = ModelingDiagnostic & {
  featureId: FeatureId
}

export function isFeatureScopedModelingDiagnostic(
  diagnostic: ModelingDiagnostic,
): diagnostic is FeatureScopedModelingDiagnostic {
  return diagnostic.featureId !== undefined && diagnostic.featureId !== null
}

export function getModelingDiagnosticRepairMessage(diagnostic: ModelingDiagnostic) {
  return diagnostic.repairGuidance ?? diagnostic.message
}
