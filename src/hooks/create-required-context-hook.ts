import { useContext, type Context } from "react";

export function createRequiredContextHook<TValue>(
  context: Context<TValue | null>,
  hookName: string,
  providerName: string,
) {
  return function useRequiredContext() {
    const value = useContext(context);

    if (!value) {
      throw new Error(`${hookName} must be used inside ${providerName}.`);
    }

    return value;
  };
}
