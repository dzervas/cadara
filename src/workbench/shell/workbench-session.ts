import type { SessionPort } from "@/application/account/session-port";
import { getAccountApiOrigin } from "@/infrastructure/account/api-origin";
import { createBrowserSession } from "@/infrastructure/account/browser-session";

let session: SessionPort | null = null;

/** The page's one account session, shared by the account menu and project sync. */
export function getWorkbenchSessionPort() {
  session ??= createBrowserSession({
    apiOrigin: getAccountApiOrigin(),
    callbackURL: new URL("/app", window.location.origin).href,
  });
  return session;
}
