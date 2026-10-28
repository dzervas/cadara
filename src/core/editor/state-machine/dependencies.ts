import type { RuntimeExtensionRegistryComposition } from "@/domain/extensions/runtime-registry-composition";

export type EditorExtensionDependencies = Pick<
  RuntimeExtensionRegistryComposition,
  "importProviders" | "sketchSpecialModes"
>;
