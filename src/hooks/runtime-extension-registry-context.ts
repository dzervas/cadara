import { createContext } from "react";

import type { RuntimeExtensionRegistryComposition } from "@/core/extensions/runtime-extension-registries";

export const RuntimeExtensionRegistryContext =
  createContext<RuntimeExtensionRegistryComposition | null>(null);
