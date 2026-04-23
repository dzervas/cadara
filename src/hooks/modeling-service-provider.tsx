import { useMemo } from "react";
import type { PropsWithChildren } from "react";

import type { ModelingService } from "@/domain/modeling/modeling-service";
import { ModelingServiceContext } from "@/hooks/modeling-service-context";

interface ModelingServiceProviderProps extends PropsWithChildren {
	modelingService: ModelingService;
}

export function ModelingServiceProvider({
	modelingService,
	children,
}: ModelingServiceProviderProps) {
	const value = useMemo(() => ({ modelingService }), [modelingService]);

	return (
		<ModelingServiceContext.Provider value={value}>{children}</ModelingServiceContext.Provider>
	);
}
