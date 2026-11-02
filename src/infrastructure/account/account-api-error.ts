/**
 * The account API answers refusals (4xx) with `{ "error": "<sentence>" }`;
 * server-side failures and plain-text errors fall back to `fallback`, so
 * operator messages such as missing configuration never reach users.
 */
export async function accountApiError(
  response: Response,
  fallback: string,
): Promise<Error> {
  if (response.status >= 500) return new Error(fallback);
  const body: unknown = await response.json().catch(() => null);
  const message =
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string" &&
    // Machine codes (snake_case) are not sentences a user can act on.
    body.error.includes(" ")
      ? body.error
      : fallback;
  return new Error(message);
}
