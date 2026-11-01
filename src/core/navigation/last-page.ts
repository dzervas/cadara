export const LAST_PAGE_KEY = "cad.lastPage.v1";

/**
 * Only same-origin application paths may be restored, never arbitrary stored
 * URLs. The query is never kept: options such as another repository database
 * or diagnostics belong to the visit that asked for them, not to every later one.
 */
export function isRememberedPage(path: string) {
  return /^\/(?:dashboard(?:\/(?:plan|members|settings|p\/[^/?#]+))?|app(?:\/(?:p|local)\/[^/?#]+)?)$/.test(
    path,
  );
}

export function resolveLastPage(
  last: string | null,
  online: boolean,
  signedIn: boolean,
) {
  if (last && isRememberedPage(last))
    return !online && last.startsWith("/dashboard") ? "/app" : last;
  return signedIn ? (online ? "/dashboard" : "/app") : null;
}

export function rememberPage(
  storage: { setItem(key: string, value: string): void },
  path: string,
) {
  if (isRememberedPage(path)) storage.setItem(LAST_PAGE_KEY, path);
}
