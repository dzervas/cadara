import type { ExportProvider } from '@/contracts/export/provider'

const REGISTERED_EXPORT_PROVIDERS: ExportProvider<unknown>[] = []
let defaultProviders: ExportProvider<unknown>[] | null = null

export function getRegisteredExportProviders(): readonly ExportProvider<unknown>[] {
  return REGISTERED_EXPORT_PROVIDERS
}

export function getExportProviderByFormat(formatId: string): ExportProvider<unknown> | undefined {
  return REGISTERED_EXPORT_PROVIDERS.find((provider) => provider.formatId === formatId)
}

export function registerExportProvider(provider: ExportProvider<unknown>) {
  if (!REGISTERED_EXPORT_PROVIDERS.some((p) => p.id === provider.id)) {
    REGISTERED_EXPORT_PROVIDERS.push(provider)
  }
}

export function registerExportProviderForTest(provider: ExportProvider<unknown>) {
  if (defaultProviders === null) {
    defaultProviders = [...REGISTERED_EXPORT_PROVIDERS]
  }
  REGISTERED_EXPORT_PROVIDERS.push(provider)
}

export function resetExportProvidersForTest() {
  if (defaultProviders !== null) {
    REGISTERED_EXPORT_PROVIDERS.length = 0
    REGISTERED_EXPORT_PROVIDERS.push(...defaultProviders)
    defaultProviders = null
  }
}
