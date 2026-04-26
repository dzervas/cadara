import type { ImportPreparedActionKind } from '@/contracts/import/actions'
import type { ImportDiagnostic } from '@/contracts/import/diagnostics'

/**
 * Generic over provider-specific review payload.
 */
export interface ImportReviewEnvelope<T> {
  providerReview: T
  proposedActionKinds: ImportPreparedActionKind[]
  diagnostics: ImportDiagnostic[]
}
