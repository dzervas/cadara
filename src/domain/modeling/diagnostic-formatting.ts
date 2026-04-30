import { getPrimitiveRefLabel } from '@/core/editor/schema'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'

function formatCommonDiagnosticDetail(detail: NonNullable<ModelingDiagnostic['detail']>): string | null {
  switch (detail.kind) {
    case 'revisionConflict':
      return `Expected ${detail.expectedRevisionId}, current ${detail.actualRevisionId}`
    case 'stalePreview':
      return `Preview ${detail.previewId} used ${detail.requestedRevisionId}; current is ${detail.currentRevisionId}`
    case 'advancedFeatureValidation':
      return detail.diagnostic.role
        ? `${detail.diagnostic.role}: ${detail.diagnostic.message}`
        : detail.diagnostic.message
    default:
      return null
  }
}

/** For use in the feature inspector (shows broken ref reason). */
export function formatInspectorDiagnosticDetail(diagnostic: ModelingDiagnostic): string | null {
  const detail = diagnostic.detail
  if (!detail) {
    return null
  }

  if (detail.kind === 'invalidReference') {
    return `Broken ref ${getPrimitiveRefLabel(detail.reference.target)}: ${detail.reference.reason}`
  }

  if (detail.kind === 'rebuildFailure') {
    return `Affected features: ${detail.affectedFeatureIds.join(', ') || 'none'}`
  }

  return formatCommonDiagnosticDetail(detail)
}

/** For use in the feature sidebar (shows source target and affected targets). */
export function formatSidebarDiagnosticDetail(diagnostic: ModelingDiagnostic): string | null {
  const detail = diagnostic.detail
  if (!detail) {
    return null
  }

  if (detail.kind === 'invalidReference') {
    return `Broken ref ${getPrimitiveRefLabel(detail.reference.target)} from ${
      detail.reference.sourceTarget ? getPrimitiveRefLabel(detail.reference.sourceTarget) : 'document state'
    }`
  }

  if (detail.kind === 'rebuildFailure') {
    return `Affected features: ${detail.affectedFeatureIds.join(', ') || 'none'} | Targets: ${
      detail.affectedTargets.map((target) => getPrimitiveRefLabel(target)).join(', ') || 'none'
    }`
  }

  return formatCommonDiagnosticDetail(detail)
}
