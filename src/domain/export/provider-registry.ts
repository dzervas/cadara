import type { ExportProvider } from '@/contracts/export/provider'

export interface ExportProviderRegistry {
  getAll(): readonly ExportProvider<unknown>[]
  getByFormat(formatId: string): ExportProvider<unknown> | undefined
}

export function createExportProviderRegistry(
  providers: readonly ExportProvider<unknown>[],
): ExportProviderRegistry {
  const dedupedProviders: ExportProvider<unknown>[] = []
  const providersByFormat = new Map<string, ExportProvider<unknown>>()
  const seenProviderIds = new Set<string>()

  for (const provider of providers) {
    if (seenProviderIds.has(provider.id)) {
      continue
    }

    seenProviderIds.add(provider.id)
    dedupedProviders.push(provider)

    if (!providersByFormat.has(provider.formatId)) {
      providersByFormat.set(provider.formatId, provider)
    }
  }

  return {
    getAll() {
      return dedupedProviders
    },
    getByFormat(formatId) {
      return providersByFormat.get(formatId)
    },
  }
}
