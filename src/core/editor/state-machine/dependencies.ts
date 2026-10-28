import type { RuntimeExtensionRegistryComposition } from "@/core/extensions/runtime-extension-registries";

export type EditorExtensionDependencies = Pick<
  RuntimeExtensionRegistryComposition,
  "importProviders" | "sketchSpecialModes"
>;
