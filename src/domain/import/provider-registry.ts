import type { ImportProvider } from '@/contracts/import/provider'
import type { ResolvedImportSource } from '@/contracts/import/source'

const REGISTERED_IMPORT_PROVIDERS: ImportProvider<unknown, unknown>[] = []

export function getRegisteredImportProviders() {
  return [...REGISTERED_IMPORT_PROVIDERS]
}

export function getImportProviderById(providerId: string) {
  return REGISTERED_IMPORT_PROVIDERS.find((provider) => provider.id === providerId) ?? null
}

export function matchImportProviders(source: ResolvedImportSource) {
  return REGISTERED_IMPORT_PROVIDERS.filter((provider) => provider.accepts(source))
}

export function getAcceptedImportFileTypes() {
  const deduped = new Map<string, { extension: string; mediaType?: string }>()

  for (const provider of REGISTERED_IMPORT_PROVIDERS) {
    for (const acceptedType of provider.acceptedFileTypes) {
      const extension = acceptedType.extension.trim().replace(/^\./, '').toLowerCase()
      const mediaType = acceptedType.mediaType?.trim().toLowerCase()

      if (!extension) {
        continue
      }

      const key = `${extension}:${mediaType ?? ''}`
      if (!deduped.has(key)) {
        deduped.set(key, { extension, ...(mediaType ? { mediaType } : {}) })
      }
    }
  }

  return [...deduped.values()]
}

export function registerImportProviderForTest(provider: ImportProvider<unknown, unknown>) {
  REGISTERED_IMPORT_PROVIDERS.push(provider)
}

export function resetImportProvidersForTest() {
  REGISTERED_IMPORT_PROVIDERS.length = 0
}
