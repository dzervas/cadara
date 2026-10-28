import type { ExportProviderRegistry } from "@/core/export/provider-registry";
import { createBuiltinExportProviderRegistry } from "@/application/export/builtin-provider-composition";
import type { ImportProviderRegistry } from "@/core/import/provider-registry";
import { createBuiltinImportProviderRegistry } from "@/infrastructure/import/builtin-provider-composition";
import type { SketchSpecialModeRegistry } from "@/core/sketch-special-modes/registry";
import { createBuiltinSketchSpecialModeRegistry } from "@/core/sketch-special-modes/builtin-registry-composition";

export interface RuntimeExtensionRegistryComposition {
  exportProviders: ExportProviderRegistry;
  importProviders: ImportProviderRegistry;
  sketchSpecialModes: SketchSpecialModeRegistry;
}

export function createBuiltinRuntimeExtensionRegistryComposition(): RuntimeExtensionRegistryComposition {
  return {
    exportProviders: createBuiltinExportProviderRegistry(),
    importProviders: createBuiltinImportProviderRegistry(),
    sketchSpecialModes: createBuiltinSketchSpecialModeRegistry(),
  };
}
