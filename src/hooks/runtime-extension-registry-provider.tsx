import { useMemo } from "react";
import type { PropsWithChildren } from "react";

import type { RuntimeExtensionRegistryComposition } from "@/domain/extensions/runtime-registry-composition";
import { RuntimeExtensionRegistryContext } from "@/hooks/runtime-extension-registry-context";

interface RuntimeExtensionRegistryProviderProps extends PropsWithChildren {
  registries: RuntimeExtensionRegistryComposition;
}

export function RuntimeExtensionRegistryProvider({
  registries,
  children,
}: RuntimeExtensionRegistryProviderProps) {
  const value = useMemo(() => registries, [registries]);

  return (
    <RuntimeExtensionRegistryContext.Provider value={value}>
      {children}
    </RuntimeExtensionRegistryContext.Provider>
  );
}
