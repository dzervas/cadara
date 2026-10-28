import type { ExportProvider } from "@/contracts/export/provider";
import type { ImportProvider } from "@/contracts/import/provider";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";
import type { SketchSpecialModeDefinition } from "@/core/sketch-special-modes/schema";
import {
  createBuiltinExportProviderRegistry,
  builtinExportProviders,
} from "@/application/export/builtin-provider-composition";
import { createExportProviderRegistry } from "@/core/export/provider-registry";
import { createImportProviderRegistry } from "@/core/import/provider-registry";
import { createSketchSpecialModeRegistry } from "@/core/sketch-special-modes/registry";
import { builtinSketchSpecialModeDefinitions } from "@/core/sketch-special-modes/builtin-definitions";
import type { RuntimeExtensionRegistryComposition } from "@/core/extensions/runtime-extension-registries";

export function createScopedExportProviderRegistryForTest(
  providers: readonly ExportProvider<
    unknown,
    FeatureEditorFormSchema
  >[] = builtinExportProviders,
) {
  return createExportProviderRegistry(providers);
}

export function createScopedImportProviderRegistryForTest(
  providers: readonly ImportProvider<
    unknown,
    unknown,
    FeatureEditorFormSchema
  >[] = [],
) {
  return createImportProviderRegistry(providers);
}

export function createScopedSketchSpecialModeRegistryForTest(
  definitions: readonly SketchSpecialModeDefinition[] = builtinSketchSpecialModeDefinitions,
) {
  return createSketchSpecialModeRegistry(definitions);
}

export function createScopedRuntimeExtensionRegistryCompositionForTest(
  input: {
    exportProviders?: readonly ExportProvider<
      unknown,
      FeatureEditorFormSchema
    >[];
    importProviders?: readonly ImportProvider<
      unknown,
      unknown,
      FeatureEditorFormSchema
    >[];
    sketchSpecialModes?: readonly SketchSpecialModeDefinition[];
  } = {},
): RuntimeExtensionRegistryComposition {
  return {
    exportProviders: input.exportProviders
      ? createExportProviderRegistry(input.exportProviders)
      : createBuiltinExportProviderRegistry(),
    importProviders: createImportProviderRegistry(input.importProviders ?? []),
    sketchSpecialModes: createSketchSpecialModeRegistry(
      input.sketchSpecialModes ?? builtinSketchSpecialModeDefinitions,
    ),
  };
}
