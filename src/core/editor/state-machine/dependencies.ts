import type { RuntimeExtensionRegistryComposition } from "@/domain/extensions/runtime-registry-composition";
import { createBuiltinImportProviderRegistry } from "@/domain/import/builtin-provider-composition";
import { createBuiltinSketchSpecialModeRegistry } from "@/domain/sketch-special-modes/builtin-registry-composition";

export type EditorExtensionDependencies = Pick<
  RuntimeExtensionRegistryComposition,
  "importProviders" | "sketchSpecialModes"
>;

export const defaultEditorExtensionDependencies: EditorExtensionDependencies = {
  importProviders: createBuiltinImportProviderRegistry(),
  sketchSpecialModes: createBuiltinSketchSpecialModeRegistry(),
};
