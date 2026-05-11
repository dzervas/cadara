import { createContext } from "react";

import type { ModelingService } from "@/domain/modeling/modeling-service";

export interface ModelingServiceContextValue {
  modelingService: ModelingService;
}

export const ModelingServiceContext =
  createContext<ModelingServiceContextValue | null>(null);
