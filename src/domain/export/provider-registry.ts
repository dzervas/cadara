import type { ExportProvider } from '@/contracts/export/provider'
import { exportProviderSupportsTarget } from '@/contracts/export/provider'
import type { DurableRef } from '@/contracts/shared/references'
import type { FeatureEditorFormSchema } from '@/core/feature-authoring/form-schema'

export interface ExportProviderRegistry {
  getAll(): readonly ExportProvider<unknown, FeatureEditorFormSchema>[]
  getByFormat(formatId: string): ExportProvider<unknown, FeatureEditorFormSchema> | undefined
  getCompatibleProviders(target: DurableRef): readonly ExportProvider<unknown, FeatureEditorFormSchema>[]
  getCompatibleFormats(target: DurableRef): readonly string[]
}

export function createExportProviderRegistry(
  providers: readonly ExportProvider<unknown, FeatureEditorFormSchema>[],
): ExportProviderRegistry {
  const dedupedProviders: ExportProvider<unknown, FeatureEditorFormSchema>[] = []
  const providersByFormat = new Map<string, ExportProvider<unknown, FeatureEditorFormSchema>>()
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
    getCompatibleProviders(target) {
      return dedupedProviders.filter((provider) => exportProviderSupportsTarget(provider, target))
    },
    getCompatibleFormats(target) {
      return this.getCompatibleProviders(target).map((provider) => provider.formatId)
    },
  }
}
