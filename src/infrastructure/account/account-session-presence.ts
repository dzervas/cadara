/**
 * Whether this browser holds an account session. It asks only for the session,
 * not the account details, and gives up after `timeoutMs`: the landing page
 * waits on the answer before it shows anything.
 */
export async function hasAccountSession(
  apiOrigin: string,
  {
    timeoutMs = 1500,
    fetcher = fetch,
  }: { timeoutMs?: number; fetcher?: typeof fetch } = {},
): Promise<boolean> {
  const response = await fetcher(new URL("/api/auth/get-session", apiOrigin), {
    credentials: "include",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return false;
  const body: unknown = await response.json();
  return (
    typeof body === "object" &&
    body !== null &&
    "session" in body &&
    body.session !== null
  );
}
