import type { ImportPreparedActions } from '@/contracts/import/actions'
import type { ImportCapabilities } from '@/contracts/import/capabilities'
import type { ImportReviewEnvelope } from '@/contracts/import/review'
import type { ResolvedImportSource } from '@/contracts/import/source'
import type { FeatureEditorFormSchema } from '@/domain/feature-authoring/form-schema'

/**
 * Providers are stateless data transformers; the review result is passed back
 * into prepare by the orchestrator.
 */
export interface ImportProvider<TReview, TSelections = unknown> {
  id: string
  label: string
  acceptedFileTypes: readonly {
    extension: string
    mediaType?: string
  }[]
  accepts(source: ResolvedImportSource): boolean
  review(input: {
    source: ResolvedImportSource
    capabilities: ImportCapabilities
  }): Promise<ImportReviewEnvelope<TReview>>
  createDefaultSelections(review: ImportReviewEnvelope<TReview>): TSelections
  getReviewFormSchema(
    review: ImportReviewEnvelope<TReview>,
    selections: TSelections,
  ): FeatureEditorFormSchema
  applySelectionPatch(
    review: ImportReviewEnvelope<TReview>,
    selections: TSelections,
    patch: Record<string, unknown>,
  ): TSelections
  prepare(input: {
    source: ResolvedImportSource
    review: ImportReviewEnvelope<TReview>
    selections: TSelections
    capabilities: ImportCapabilities
  }): Promise<ImportPreparedActions>
}
