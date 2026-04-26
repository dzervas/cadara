import type { ImportProvider } from '@/contracts/import/provider'
import type { ResolvedImportSource } from '@/contracts/import/source'
import { createImageImportProvider, type ImageImportReview, type ImageImportSelections } from '@/domain/import/providers/image-import-provider'

const REGISTERED_IMPORT_PROVIDERS: readonly ImportProvider<unknown, unknown>[] = [
  createImageImportProvider() as ImportProvider<ImageImportReview, ImageImportSelections>,
]

export function getRegisteredImportProviders() {
  return [...REGISTERED_IMPORT_PROVIDERS]
}

export function matchImportProviders(source: ResolvedImportSource) {
  return REGISTERED_IMPORT_PROVIDERS.filter((provider) => provider.accepts(source))
}
