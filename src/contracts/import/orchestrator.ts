import type { ImportProvider } from '@/contracts/import/provider'
import type { ImportResult } from '@/contracts/import/result'
import type { ImportReviewEnvelope } from '@/contracts/import/review'
import type { ImportSource, ResolvedImportSource } from '@/contracts/import/source'

/**
 * Resolves transport, runs the provider pipeline, and applies prepared actions
 * through the existing adapter contract. No implementation lives here.
 */
export interface ImportOrchestrator {
  resolveSource(source: ImportSource): Promise<ResolvedImportSource>
  matchProviders(source: ResolvedImportSource): ImportProvider<unknown>[]
  executeImport<TReview, TSelections = unknown>(
    provider: ImportProvider<TReview, TSelections>,
    source: ResolvedImportSource,
    review: ImportReviewEnvelope<TReview>,
    selections: TSelections,
  ): Promise<ImportResult>
}
