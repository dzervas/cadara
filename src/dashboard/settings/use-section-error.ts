import { useCallback, useState } from "react";

/** A section's last failure, shown inside that section until dismissed. */
export function useSectionError() {
  const [error, setError] = useState<string | null>(null);
  const fail = useCallback(
    (reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    [],
  );
  return { error, fail, clear: useCallback(() => setError(null), []) };
}
