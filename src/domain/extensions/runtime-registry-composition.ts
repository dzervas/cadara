import type { ExportProviderRegistry } from "@/domain/export/provider-registry";
import { createBuiltinExportProviderRegistry } from "@/domain/export/builtin-provider-composition";
import type { ImportProviderRegistry } from "@/domain/import/provider-registry";
import { createBuiltinImportProviderRegistry } from "@/domain/import/builtin-provider-composition";
import type { SketchSpecialModeRegistry } from "@/core/sketch-special-modes/registry";
import { createBuiltinSketchSpecialModeRegistry } from "@/domain/sketch-special-modes/builtin-registry-composition";

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
