import type { ExportProviderRegistry } from "@/core/export/provider-registry";
import type { ImportProviderRegistry } from "@/core/import/provider-registry";
import type { SketchSpecialModeRegistry } from "@/core/sketch-special-modes/registry";

export interface RuntimeExtensionRegistryComposition {
  exportProviders: ExportProviderRegistry;
  importProviders: ImportProviderRegistry;
  sketchSpecialModes: SketchSpecialModeRegistry;
}
