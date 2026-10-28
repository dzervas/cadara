import { createImportProviderRegistry } from "@/core/import/provider-registry";
import { onshapeImportProvider } from "@/infrastructure/import/onshape/provider";

export function createBuiltinImportProviderRegistry() {
  return createImportProviderRegistry([onshapeImportProvider]);
}
