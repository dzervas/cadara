import { RuntimeExtensionRegistryContext } from "@/hooks/runtime-extension-registry-context";
import { createRequiredContextHook } from "@/hooks/create-required-context-hook";

export const useRuntimeExtensionRegistry = createRequiredContextHook(
  RuntimeExtensionRegistryContext,
  "useRuntimeExtensionRegistry",
  "RuntimeExtensionRegistryProvider",
);
