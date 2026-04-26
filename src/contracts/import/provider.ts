import type { ImportPreparedActions } from '@/contracts/import/actions'
import type { ImportCapabilities } from '@/contracts/import/capabilities'
import type { ImportReviewEnvelope } from '@/contracts/import/review'
import type { ResolvedImportSource } from '@/contracts/import/source'

/**
 * Providers are stateless data transformers; the review result is passed back
 * into prepare by the orchestrator.
 */
export interface ImportProvider<TReview, TSelections = unknown> {
  id: string
  label: string
  accepts(source: ResolvedImportSource): boolean
  review(input: {
    source: ResolvedImportSource
    capabilities: ImportCapabilities
  }): Promise<ImportReviewEnvelope<TReview>>
  prepare(input: {
    source: ResolvedImportSource
    review: ImportReviewEnvelope<TReview>
    selections: TSelections
    capabilities: ImportCapabilities
  }): Promise<ImportPreparedActions>
}
