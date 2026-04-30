import { createImportProviderRegistry } from '@/domain/import/provider-registry'

export function createBuiltinImportProviderRegistry() {
  return createImportProviderRegistry([])
}
