import { createBuiltinExportProviderRegistry } from "@/application/export/builtin-provider-composition";
import type { RuntimeExtensionRegistryComposition } from "@/core/extensions/runtime-extension-registries";
import { createBuiltinImportProviderRegistry } from "@/infrastructure/import/builtin-provider-composition";
import { createBuiltinSketchSpecialModeRegistry } from "@/core/sketch-special-modes/builtin-registry-composition";

export function createBuiltinRuntimeExtensionRegistryComposition(): RuntimeExtensionRegistryComposition {
  return {
    exportProviders: createBuiltinExportProviderRegistry(),
    importProviders: createBuiltinImportProviderRegistry(),
    sketchSpecialModes: createBuiltinSketchSpecialModeRegistry(),
  };
}
