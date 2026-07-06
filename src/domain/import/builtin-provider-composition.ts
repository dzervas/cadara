import { createImportProviderRegistry } from "@/domain/import/provider-registry";
import { onshapeImportProvider } from "@/domain/import/onshape/provider";

export function createBuiltinImportProviderRegistry() {
  return createImportProviderRegistry([onshapeImportProvider]);
}
