/**
 * Timing rules of a project's live connection.
 *
 * A socket's sync token is fixed when it opens and the room closes it once
 * the token expires, so the connection reopens with a fresh token before
 * that: one minute early, or halfway through a token shorter than two
 * minutes. Failed attempts back off exponentially up to thirty seconds.
 */
export const SYNC_TOKEN_REFRESH_MARGIN_MS = 60_000;
export const SYNC_RECONNECT_BASE_DELAY_MS = 1_000;
export const SYNC_RECONNECT_MAX_DELAY_MS = 30_000;

/** Milliseconds after a socket opens with a token valid for `expiresInSeconds`. */
export function syncTokenRefreshDelayMs(expiresInSeconds: number) {
  const lifetime = expiresInSeconds * 1000;
  return Math.max(
    lifetime - SYNC_TOKEN_REFRESH_MARGIN_MS,
    Math.floor(lifetime / 2),
  );
}

/** Delay before reconnect attempt number `failures` (1 = first failure). */
export function syncReconnectDelayMs(failures: number) {
  if (failures <= 0) return 0;
  return Math.min(
    SYNC_RECONNECT_BASE_DELAY_MS * 2 ** (failures - 1),
    SYNC_RECONNECT_MAX_DELAY_MS,
  );
}
