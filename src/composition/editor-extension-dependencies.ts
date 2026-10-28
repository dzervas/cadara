import type { EditorExtensionDependencies } from "@/core/editor/state-machine/dependencies";
import { createBuiltinImportProviderRegistry } from "@/infrastructure/import/builtin-provider-composition";
import { createBuiltinSketchSpecialModeRegistry } from "@/core/sketch-special-modes/builtin-registry-composition";

export const defaultEditorExtensionDependencies: EditorExtensionDependencies = {
  importProviders: createBuiltinImportProviderRegistry(),
  sketchSpecialModes: createBuiltinSketchSpecialModeRegistry(),
};
