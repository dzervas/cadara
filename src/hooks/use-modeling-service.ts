import { ModelingServiceContext } from "@/hooks/modeling-service-context";
import { createRequiredContextHook } from "@/hooks/create-required-context-hook";

const useModelingServiceContext = createRequiredContextHook(
  ModelingServiceContext,
  "useModelingService",
  "ModelingServiceProvider",
);

export function useModelingService() {
  return useModelingServiceContext().modelingService;
}
